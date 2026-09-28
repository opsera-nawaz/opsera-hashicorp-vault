/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

/*
  This service is used to pull an OpenAPI document describing the
  shape of data at a specific path to hydrate a model with attrs it
  has less (or no) information about.
*/
import Model, { attr } from '@ember-data/model';
import Service from '@ember/service';
import { getOwner } from '@ember/owner';
import { resolve, reject } from 'rsvp';
import { debug } from '@ember/debug';
import { capitalize } from '@ember/string';

import {
  filterPathsByItemType,
  pathToHelpUrlSegment,
  reducePathsByPathName,
  getHelpUrlForModel,
  combineOpenApiAttrs,
  expandOpenApiProps,
} from 'vault/utils/openapi-helpers';
import GeneratedItemModel from 'vault/models/generated-item';
import GeneratedItemListAdapter from 'vault/adapters/generated-item-list';

import type Owner from '@ember/owner';
import type Store from '@ember-data/store';
import type { OpenApiProps, PathInfo } from 'vault/utils/openapi-helpers';

/* -----------------------------------------------------------------------
 * OpenAPI response interfaces
 *
 * These mirror the JSON shapes generated server-side:
 *   - sdk/framework/openapi.go: OASDocument / OASPathItem / OASOperation /
 *     OASParameter / OASRequestBody / OASResponse / OASSchema
 *   - sdk/framework/path.go: DisplayAttributes (the x-vault-displayAttrs
 *     extension)
 *   - api/help.go: Help{ Help, SeeAlso, OpenAPI } (serialized as
 *     help/see_also/openapi, returned by GET /v1/{path}?help=true)
 * -------------------------------------------------------------------- */

/** Vault's `x-vault-displayAttrs` extension — sdk/framework/path.go DisplayAttributes */
export interface OpenApiDisplayAttrs {
  name?: string;
  description?: string;
  value?: unknown;
  sensitive?: boolean;
  navigation?: boolean;
  itemType?: string;
  group?: string;
  action?: string;
}

/** OpenAPI 3.0 Schema Object with Vault's x-vault-* extensions — OASSchema */
export interface OpenApiSchema {
  $ref?: string;
  type?: string;
  description?: string;
  properties?: Record<string, OpenApiSchema>;
  additionalProperties?: unknown;
  required?: string[];
  items?: OpenApiSchema;
  format?: string;
  pattern?: string;
  enum?: unknown[];
  default?: unknown;
  example?: unknown;
  deprecated?: boolean;
  isId?: boolean;
  'x-vault-displayValue'?: unknown;
  'x-vault-displaySensitive'?: boolean;
  'x-vault-displayGroup'?: string;
  'x-vault-displayAttrs'?: OpenApiDisplayAttrs;
}

/** OpenAPI 3.0 Parameter Object — OASParameter */
export interface OpenApiParameter {
  name: string;
  description?: string;
  in: string;
  schema?: OpenApiSchema;
  required?: boolean;
  deprecated?: boolean;
}

/** OpenAPI 3.0 Request Body Object — OASRequestBody */
export interface OpenApiRequestBody {
  description?: string;
  required?: boolean;
  content: Record<string, { schema?: OpenApiSchema }>;
}

/** OpenAPI 3.0 Response Object — OASResponse */
export interface OpenApiResponse {
  description: string;
  content?: Record<string, { schema?: OpenApiSchema }>;
}

/** OpenAPI 3.0 Operation Object — OASOperation */
export interface OpenApiOperation {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: Record<string, OpenApiResponse>;
  deprecated?: boolean;
}

/**
 * A single entry of the `openapi.paths` map returned by both
 * /v1/sys/internal/specs/openapi and GET /v1/{path}?help=true — OASPathItem.
 */
export interface OpenApiPathItem {
  description?: string;
  parameters?: OpenApiParameter[];
  'x-vault-sudo'?: boolean;
  'x-vault-unauthenticated'?: boolean;
  'x-vault-createSupported'?: boolean;
  'x-vault-displayAttrs'?: OpenApiDisplayAttrs;
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
}

/** OpenAPI 3.0 Components Object — OASComponents */
export interface OpenApiComponents {
  schemas: Record<string, OpenApiSchema>;
}

/** Top-level OpenAPI 3.0 document — OASDocument */
export interface OpenApiDocument {
  openapi: string;
  info: {
    title: string;
    description: string;
    version: string;
    license: { name: string; url: string };
  };
  paths: Record<string, OpenApiPathItem>;
  components: OpenApiComponents;
}

/**
 * Response shape for `GET /v1/{path}?help=true` — api/help.go's `Help` struct
 * (fields Help/SeeAlso/OpenAPI, serialized as help/see_also/openapi).
 */
export interface OpenApiHelpResponse {
  help: string;
  see_also: string[];
  openapi: OpenApiDocument;
}

/**
 * A merged attribute produced by combining a model's existing attrs with
 * OpenAPI-derived props — mirrors openapi-helpers.ts's internal Attribute
 * shape (name, type, options) without needing to import that unexported type.
 */
export type ResolvedFieldAttribute = ReturnType<typeof combineOpenApiAttrs>['attrs'][number];

/**
 * A single OpenAPI property after expandOpenApiProps() has derived UI-facing
 * metadata (editType, possibleValues, sensitive, etc.) from raw OpenAPI schema
 * props — mirrors openapi-helpers.ts's internal MixedAttr shape without
 * needing to import that unexported type. This is what getProps() resolves
 * to, and what combineOpenApiAttrs()'s second argument expects.
 */
export type OpenApiExpandedProps = ReturnType<typeof expandOpenApiProps>;

/**
 * Result of resolving all OpenAPI paths for a backend/apiPath — re-exported
 * under this story's naming for callers of this service; identical in shape
 * to openapi-helpers.ts's PathInfo, which getPaths()/getNewModel() build via
 * reducePathsByPathName().
 */
export type PathResolutionResult = PathInfo;

/**
 * store.modelFor() resolves to EmberData's ModelSchema, which does not know
 * about the `merged` flag this service stamps onto generated model classes
 * (see _upgradeModelSchema) to avoid re-hydrating the same model twice.
 */
type ModelClassWithMergedFlag = typeof Model & { merged?: boolean };

/**
 * store._modelFactoryCache is an EmberData-private cache (undocumented, not
 * part of the public Store type) that must be busted whenever a model is
 * re-registered under an existing modelType so EmberData's factory lookup
 * picks up the newly hydrated class instead of a stale cached one.
 */
interface StoreWithPrivateModelCache extends Store {
  _modelFactoryCache: Record<string, unknown>;
}

interface AjaxOptions {
  data?: Record<string, unknown>;
}

/**
 * `unregister` is implemented by every real Owner at runtime (it's part of
 * Ember's internal RegistryProxyMixin/ContainerProxyMixin) but is not part of
 * the narrower public `Owner` type ember-source exports from `@ember/owner`.
 */
interface OwnerWithUnregister extends Owner {
  unregister(fullName: string): void;
}

export default class PathHelpService extends Service {
  ajax<T = unknown>(url: string, options: AjaxOptions = {}): Promise<T> {
    const owner = getOwner(this) as Owner;
    const appAdapter = owner.lookup('adapter:application') as {
      ajax: (url: string, method: string, options: AjaxOptions) => Promise<T>;
    };
    const { data } = options;
    return appAdapter.ajax(url, 'GET', {
      data,
    });
  }

  /**
   * Registers new ModelClass at specified model type, and busts cache
   */
  _registerModel(owner: Owner, NewKlass: object, modelType: string, isNew = false): void {
    const store = owner.lookup('service:store') as StoreWithPrivateModelCache;
    // bust cache in ember's registry
    if (!isNew) {
      (owner as OwnerWithUnregister).unregister(`model:${modelType}`);
    }
    owner.register(`model:${modelType}`, NewKlass);

    // bust cache in EmberData's model lookup
    delete store._modelFactoryCache[modelType];
  }

  /**
   * upgradeModelSchema takes an existing ModelClass and hydrates it with the passed attributes
   * @param Klass model class retrieved with store.modelFor(modelType)
   * @param attrs array of attributes {name, type, options}
   * @returns new ModelClass extended from passed one, with the passed attributes added
   */
  _upgradeModelSchema(
    Klass: typeof Model,
    attrs: ResolvedFieldAttribute[],
    newFields?: string[]
  ): ModelClassWithMergedFlag {
    // extending the class will ensure that static schema lookups regenerate
    const NewKlass = class extends Klass {} as ModelClassWithMergedFlag;

    for (const { name, type, options } of attrs) {
      const decorator = attr(type, options);
      // the attr decorator's declared return type is `void` even though it actually
      // returns a PropertyDescriptor — see @ember-data/model's own attr.d.ts comment
      const descriptor = decorator(NewKlass.prototype, name, {}) as unknown as PropertyDescriptor;
      Object.defineProperty(NewKlass.prototype, name, descriptor);
    }

    // newFields is used in combineFieldGroups within various models
    if (newFields) {
      (NewKlass.prototype as GeneratedItemModel & { newFields?: string[] }).newFields = newFields;
    }

    // Ensure this class doesn't get re-hydrated
    NewKlass.merged = true;

    return NewKlass;
  }

  /**
   * hydrateModel instantiates models which use OpenAPI partially
   * @param modelType path for model, eg pki/role
   * @param backend path, which will be used for the generated helpUrl
   * @returns void - as side effect, re-registers model via upgradeModelSchema
   */
  async hydrateModel(modelType: string, backend: string): Promise<void> {
    const owner = getOwner(this) as Owner;
    const helpUrl = getHelpUrlForModel(modelType, backend);
    const store = owner.lookup('service:store') as Store;
    const Klass = store.modelFor(modelType) as unknown as ModelClassWithMergedFlag;

    if (Klass?.merged || !helpUrl) {
      // if the model is already merged, we don't need to do anything
      return resolve();
    }
    debug(`Hydrating model ${modelType} at backend ${backend}`);

    // fetch props from openAPI
    const props = await this.getProps(helpUrl);
    // combine existing attributes with openAPI data
    // Klass.attributes is EmberData's LegacyAttributeField map; it carries the
    // same {name, type, options} shape combineOpenApiAttrs expects.
    const { attrs, newFields } = combineOpenApiAttrs(Klass.attributes, props);
    debug(`${modelType} has ${newFields.length} new fields: ${newFields.join(', ')}`);

    // hydrate model
    const HydratedKlass = this._upgradeModelSchema(Klass, attrs, newFields);

    this._registerModel(owner, HydratedKlass, modelType);
  }

  /**
   * getNewModel instantiates models which use OpenAPI to generate the model fully
   * @param modelType
   * @param backend
   * @param apiPath this method will call getPaths and build submodels for item types
   * @param itemType (optional) used in getPaths for additional models
   * @returns void - as side effect, registers model via registerNewModelWithAttrs
   */
  getNewModel(modelType: string, backend: string, apiPath: string, itemType?: string): Promise<void> {
    const owner = getOwner(this) as Owner;

    const modelFactory = owner.factoryFor(`model:${modelType}`) as
      | { class: ModelClassWithMergedFlag }
      | undefined;

    if (modelFactory) {
      // if the modelFactory already exists, it means either this model was already
      // generated or the model exists in the code already. In either case resolve

      if (!modelFactory.class.merged) {
        // no merged flag means this model was not previously generated
        debug(`Model exists for ${modelType} -- use hydrateModel instead`);
      }
      return resolve();
    }
    debug(`Creating new Model for ${modelType}`);
    let newModel = Model.extend({});

    // use paths to dynamically create our openapi help url
    // if we have a brand new model
    return this.getPaths(apiPath, backend, itemType)
      .then((pathInfo) => {
        const adapterFactory = owner.factoryFor(`adapter:${modelType}`);
        // if we have an adapter already use that, otherwise create one
        if (!adapterFactory) {
          debug(`Creating new adapter for ${modelType}`);
          const adapter = this.getNewAdapter(pathInfo, itemType);
          owner.register(`adapter:${modelType}`, adapter);
        }
        // if we have an item we want the create info for that itemType
        const paths = itemType ? filterPathsByItemType(pathInfo, itemType) : pathInfo.paths;
        const createPath = paths.find((path) => path.operations.includes('post') && path.action !== 'Delete');
        if (!createPath) {
          // TODO: we don't know if createPath will ever be falsey
          // if it is never falsey we can remove this.
          return reject();
        }
        const path = pathToHelpUrlSegment(createPath.path);
        if (!path) {
          // TODO: we don't know if path will ever be falsey
          // if it is never falsey we can remove this.
          return reject();
        }

        const helpUrl = `/v1/${apiPath}${path.slice(1)}?help=true`;
        pathInfo.paths = paths;
        newModel = newModel.extend({ paths: pathInfo });
        return this.registerNewModelWithAttrs(helpUrl, modelType);
      })
      .catch((err: unknown) => {
        // TODO: we should handle the error better here
        console.error(err); // eslint-disable-line
      });
  }

  /**
   * getPaths is used to fetch all the openAPI paths available for an auth method,
   * to populate the tab navigation in each specific method page
   * @param apiPath path of openApi
   * @param backend backend name, mostly for debug purposes
   * @param itemType optional
   * @param itemID optional - ID of specific item being fetched
   * @returns PathsInfo
   */
  getPaths(
    apiPath: string,
    backend: string,
    itemType?: string,
    itemID?: string
  ): Promise<PathResolutionResult> {
    const debugString =
      itemID && itemType
        ? `Fetching relevant paths for ${backend} ${itemType} ${itemID} from ${apiPath}`
        : `Fetching relevant paths for ${backend} ${itemType} from ${apiPath}`;
    debug(debugString);
    return this.ajax<OpenApiHelpResponse>(`/v1/${apiPath}?help=1`).then((help) => {
      const pathInfo = help.openapi.paths;
      const paths = Object.entries(pathInfo) as unknown as Parameters<typeof reducePathsByPathName>[1][];

      const initialPathInfo: PathInfo = {
        apiPath,
        itemType,
        itemTypes: [],
        paths: [],
        itemID,
      };
      return paths.reduce(reducePathsByPathName, initialPathInfo);
    });
  }

  // Makes a call to grab the OpenAPI document.
  // Returns relevant information from OpenAPI
  // as determined by the expandOpenApiProps util
  getProps(helpUrl: string): Promise<OpenApiExpandedProps> {
    // add name of thing you want
    debug(`Fetching schema properties from ${helpUrl}`);

    return this.ajax<OpenApiHelpResponse>(helpUrl).then((help) => {
      // paths is an array but it will have a single entry
      // for the scope we're in
      const [path] = Object.keys(help.openapi.paths); // do this or look at name
      const pathInfo = path ? help.openapi.paths[path] : undefined;
      const params = pathInfo?.parameters;
      const paramProp: OpenApiProps = {};

      // include url params
      const firstParam = params?.[0];
      if (firstParam) {
        const { name, schema, description } = firstParam;
        const label = capitalize(name.split('_').join(' '));

        paramProp[name] = {
          'x-vault-displayAttrs': {
            name: label,
            group: 'default',
          },
          type: schema?.type ?? '',
          description: description ?? '',
          isId: true,
        };
      }

      let props: OpenApiProps = {};
      const schema = pathInfo?.post?.requestBody?.content['application/json']?.schema;
      if (schema?.$ref) {
        // $ref will be shaped like `#/components/schemas/MyResponseType
        // which maps to the location of the item within the openApi response
        const loc = schema.$ref.replace('#/', '').split('/');
        const resolved = loc.reduce<Record<string, unknown>>(
          (prev, curr) => {
            return (prev[curr] as Record<string, unknown>) || {};
          },
          help.openapi as unknown as Record<string, unknown>
        );
        props = (resolved['properties'] as OpenApiProps) || {};
      } else if (schema?.properties) {
        props = schema.properties as OpenApiProps;
      }
      // put url params (e.g. {name}, {role}) at the front of the props list
      const newProps: OpenApiProps = { ...paramProp, ...props };
      return expandOpenApiProps(newProps);
    });
  }

  getNewAdapter(pathInfo: PathResolutionResult, itemType?: string): typeof GeneratedItemListAdapter {
    // we need list and create paths to set the correct urls for actions
    const paths = filterPathsByItemType(pathInfo, itemType ?? '');
    const { apiPath } = pathInfo;
    const getPath = paths.find((path) => path.operations.includes('get'));

    // the action might be "Generate" or something like that so we'll grab the first post endpoint if there
    // isn't one with "Create"
    // TODO: look into a more sophisticated way to determine the create endpoint
    const createPath = paths.find((path) => path.action === 'Create' || path.operations.includes('post'));
    const deletePath = paths.find((path) => path.operations.includes('delete'));

    return class NewAdapter extends GeneratedItemListAdapter {
      apiPath = apiPath;

      paths = {
        createPath: createPath?.path,
        deletePath: deletePath?.path,
        getPath: getPath?.path,
      };
    };
  }

  /**
   * registerNewModelWithAttrs takes the helpUrl of the given model type,
   * fetches props, and registers the model hydrated with the provided attrs
   * @param helpUrl like /v1/auth/userpass2/users/example?help=true
   * @param modelType like generated-user-userpass
   */
  async registerNewModelWithAttrs(helpUrl: string, modelType: string): Promise<void> {
    const owner = getOwner(this) as Owner;
    const props = await this.getProps(helpUrl);
    const { attrs, newFields } = combineOpenApiAttrs(new Map<string, ResolvedFieldAttribute>(), props);
    const NewKlass = this._upgradeModelSchema(GeneratedItemModel, attrs, newFields);
    this._registerModel(owner, NewKlass, modelType, true);
  }
}
