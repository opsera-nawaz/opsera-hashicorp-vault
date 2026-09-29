/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

/**
 * General use adapter to access specified paths on secrets engines
 * For example /:backend/config is a typical use case for this adapter
 * These types of records do not have an id and use the backend value of the secrets engine as the primaryKey in the serializer
 */

import ApplicationAdapter from 'vault/adapters/application';
import { encodePath } from 'vault/utils/path-encoding-helpers';

import type Store from '@ember-data/store';
import type { AdapterModelSchema, AdapterSnapshot, AdapterSerializer } from './-types';

export default class SecretsEnginePathAdapter extends ApplicationAdapter {
  namespace = 'v1';
  // define path value in extending class or pass into method directly
  path: string | undefined;

  // define path value in extending class or pass into method directly
  _getURL(backend: string, path?: string): string {
    return `${this.buildURL()}/${encodePath(backend)}/${path || this.path}`;
  }
  // @ts-expect-error - concrete override of RESTAdapter's generic urlForUpdateRecord<K>; this
  // codebase's adapters consistently override with concrete (non-generic) params, see
  // app/adapters/-types.ts.
  urlForUpdateRecord(_name: string, _modelName: string, snapshot: AdapterSnapshot): string {
    return this._getURL(snapshot.attr('backend') as string);
  }
  // primaryKey must be set to backend in serializer
  urlForDeleteRecord(backend: string): string {
    return this._getURL(backend);
  }

  queryRecord(_store: Store, _type: AdapterModelSchema, query: { backend: string }) {
    const { backend } = query;
    return this.ajax(this._getURL(backend), 'GET').then((resp: Record<string, unknown>) => {
      resp['backend'] = backend;
      return resp;
    });
  }
  // @ts-expect-error - see urlForUpdateRecord above
  createRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    return this._saveRecord(store, type, snapshot);
  }
  // @ts-expect-error - see urlForUpdateRecord above
  updateRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    return this._saveRecord(store, type, snapshot);
  }
  _saveRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const { modelName } = type;
    const data = (store.serializerFor(modelName as never) as AdapterSerializer).serialize(snapshot) as Record<
      string,
      unknown
    >;
    const primaryKey = (store.serializerFor(modelName as never) as AdapterSerializer).primaryKey;
    const url = this._getURL(snapshot.attr('backend') as string);
    return this.ajax(url, 'POST', { data }).then(() => {
      data[primaryKey] = snapshot.attr(primaryKey);
      return data;
    });
  }
}
