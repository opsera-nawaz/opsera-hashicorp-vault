/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import RESTSerializer from '@ember-data/serializer/rest';
import { AVAILABLE_PLUGIN_TYPES } from '../../utils/model-helpers/database-helpers';

import type Store from '@ember-data/store';
import type { ModelSchema } from 'ember-data'; // eslint-disable-line ember/use-ember-data-rfc-395-imports
import type { AdapterSnapshot } from 'vault/adapters/-types';

interface DatabasePluginField {
  attr: string;
}

interface DatabasePluginType {
  value: string;
  fields: DatabasePluginField[];
}

interface ConnectionPayload {
  id?: string | number;
  backend?: string;
  data: {
    keys?: string[];
    connection_details?: Record<string, unknown>;
    root_credentials_rotate_statements?: unknown;
    connection_url?: string;
    [key: string]: unknown;
  };
}

export default class DatabaseConnectionSerializer extends RESTSerializer {
  primaryKey = 'name';

  // @ts-expect-error - concrete override of RESTSerializer's generic serializeAttribute<K>; the
  // loose AdapterSnapshot stand-in (see app/adapters/-types.ts) isn't assignable to Snapshot<K>.
  serializeAttribute(
    snapshot: AdapterSnapshot,
    json: Record<string, unknown>,
    key: string,
    attributes: Record<string, unknown>
  ): void {
    // Don't send values that are undefined
    if (undefined !== snapshot.attr(key)) {
      super.serializeAttribute(snapshot as never, json, key, attributes);
    }
  }

  normalizeSecrets(payload: ConnectionPayload) {
    if (payload.data.keys && Array.isArray(payload.data.keys)) {
      const connections = payload.data.keys.map((secret) => ({ name: secret, backend: payload.backend }));
      return connections;
    }
    // Query single record response:
    const response: Record<string, unknown> = {
      id: payload.id,
      name: payload.id,
      backend: payload.backend,
      ...payload.data,
      ...payload.data.connection_details,
    };

    // connection_details are spread above into the main body of response so we can remove redundant data
    delete response['connection_details'];
    if (response['connection_url']) {
      // this url can include interpolated data, such as: "{{username}}/{{password}}@localhost:1521/OraDoc.localhost"
      // these curly brackets are returned by the API encoded: "%7B%7Busername%7D%7D/%7B%7Bpassword%7D%7D@localhost:1521/OraDoc.localhost"
      // we decode here so the UI displays and submits the url in the correct format
      response['connection_url'] = decodeURI(response['connection_url'] as string);
    }

    if (payload.data.root_credentials_rotate_statements) {
      response['root_rotation_statements'] = payload.data.root_credentials_rotate_statements;
    }
    return response;
  }

  normalizeResponse(
    store: Store,
    primaryModelClass: ModelSchema,
    payload: ConnectionPayload,
    id: string | number,
    requestType: string
  ) {
    const nullResponses = ['updateRecord', 'createRecord', 'deleteRecord'];
    const connections = nullResponses.includes(requestType)
      ? { name: payload.data['name'], backend: payload.data['backend'] }
      : this.normalizeSecrets(payload);
    const { modelName } = primaryModelClass;
    let transformedPayload: Record<string, unknown> = { [modelName]: connections };
    if (requestType === 'queryRecord') {
      // comes back as object anyway
      transformedPayload = { [modelName]: { id, ...connections } };
    }
    return super.normalizeResponse(store, primaryModelClass, transformedPayload, id, requestType);
  }

  // @ts-expect-error - concrete override of RESTSerializer's generic serialize<K>; the loose
  // AdapterSnapshot stand-in isn't assignable to Snapshot<K>.
  serialize(snapshot: AdapterSnapshot, requestType?: string) {
    const data = super.serialize(snapshot as never, requestType as never) as Record<string, unknown>;
    if (!data['plugin_name']) {
      return data;
    }
    const pluginType = (AVAILABLE_PLUGIN_TYPES as DatabasePluginType[]).find(
      (plugin) => plugin.value === data['plugin_name']
    );
    if (!pluginType) {
      return data;
    }
    const pluginAttributes = pluginType.fields.map((field) => field.attr).concat('backend');

    // filter data to only allow plugin specific attrs
    const allowedAttributes = Object.keys(data).filter((dataAttrs) => pluginAttributes.includes(dataAttrs));
    for (const key in data) {
      // All connections allow allowed_roles but it's not shown on the form
      if (key !== 'allowed_roles' && !allowedAttributes.includes(key)) {
        delete data[key];
      }
    }
    return data;
  }
}
