/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import AdapterError from '@ember-data/adapter/error';
import { set } from '@ember/object';
import ApplicationAdapter from './application';
import { sanitizePath, sanitizeStart } from 'core/utils/sanitize-path';

import type Store from '@ember-data/store';
import type { AdapterModelSchema } from './-types';

interface CapabilitiesQuery {
  paths: string[];
}

export default class CapabilitiesAdapter extends ApplicationAdapter {
  pathForType(): string {
    return 'capabilities-self';
  }

  /*
  users don't always have access to the capabilities-self endpoint in the current namespace,
  this can happen when logging in to a namespace and then navigating to a child namespace.
  adding "relativeNamespace" to the path and/or "this.namespaceService.userRootNamespace"
  to the request header ensures we are querying capabilities-self in the user's root namespace,
  which is where they are most likely to have their policy/permissions.
  */
  _formatPath(path: string): string {
    const { relativeNamespace } = this.namespaceService;
    if (!relativeNamespace) {
      return path;
    }
    // ensure original path doesn't have leading slash
    return `${relativeNamespace}/${sanitizeStart(path)}`;
  }

  findRecord(_store: Store, type: AdapterModelSchema, id: string) {
    const paths = [this._formatPath(id)];
    return this.ajax(this.buildURL(type.modelName as never), 'POST', {
      data: { paths },
      namespace: sanitizePath(this.namespaceService.userRootNamespace),
    }).catch((e: unknown) => {
      if (e instanceof AdapterError) {
        set(e, 'policyPath', 'sys/capabilities-self');
      }
      throw e;
    });
  }

  // @ts-expect-error - concrete override of RESTAdapter's generic queryRecord<K>; this codebase's
  // adapters consistently override with concrete (non-generic) params, see app/adapters/-types.ts.
  queryRecord(store: Store, type: AdapterModelSchema, query: { id?: string }) {
    const { id } = query;
    if (!id) {
      return;
    }
    return this.findRecord(store, type, id).then((resp: Record<string, unknown>) => {
      resp['path'] = id;
      return resp;
    });
  }

  query(_store: Store, type: AdapterModelSchema, query: CapabilitiesQuery) {
    const pathMap = query?.paths.reduce((mapping: Record<string, string>, path) => {
      const withNs = this._formatPath(path);
      if (withNs) {
        mapping[withNs] = path;
      }
      return mapping;
    }, {});

    return this.ajax(this.buildURL(type.modelName as never), 'POST', {
      data: { paths: Object.keys(pathMap) },
      namespace: sanitizePath(this.namespaceService.userRootNamespace),
    })
      .then((queryResult: Record<string, unknown> | undefined) => {
        if (queryResult) {
          // send the pathMap with the response so the serializer can normalize the paths to be relative to the namespace
          queryResult['pathMap'] = pathMap;
        }
        return queryResult;
      })
      .catch((e: unknown) => {
        if (e instanceof AdapterError) {
          set(e, 'policyPath', 'sys/capabilities-self');
        }
        throw e;
      });
  }
}
