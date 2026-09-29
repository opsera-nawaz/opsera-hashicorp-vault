/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationAdapter from '../application';
import { encodePath } from 'vault/utils/path-encoding-helpers';

import type Store from '@ember-data/store';
import type { AdapterModelSchema, AdapterSnapshot, AdapterSerializer } from '../-types';

interface TransformQuery {
  backend: string;
  modelName: string;
  id?: string;
}

export default class TransformBaseAdapter extends ApplicationAdapter {
  namespace = 'v1';

  pathForType(type: string): string {
    return type.replace('transform/', '');
  }

  createOrUpdate(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const { backend, name } = snapshot.record as unknown as { backend: string; name: string };
    const serializer = store.serializerFor(type.modelName as never) as AdapterSerializer;
    const data = serializer.serialize(snapshot);
    const url = this.url(backend, type.modelName, name);
    return this.ajax(url, 'POST', { data }).then((resp: { data?: { name?: string } } | undefined) => {
      // Ember data doesn't like 204 responses except for DELETE method
      const response = resp || { data: {} };
      response.data!.name = name;
      return response;
    });
  }

  // @ts-expect-error - see pathForType above
  createRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    return this.createOrUpdate(store, type, snapshot);
  }

  // @ts-expect-error - see pathForType above
  updateRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    return this.createOrUpdate(store, type, snapshot);
  }

  // @ts-expect-error - see pathForType above
  deleteRecord(_store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const { id } = snapshot;
    const record = snapshot.record as unknown as { backend: string };
    return this.ajax(this.url(record.backend, type.modelName, id), 'DELETE');
  }

  url(backend: string, modelType: string, id?: string): string {
    const type = this.pathForType(modelType);
    const url = `/${this.namespace}/${encodePath(backend)}/${encodePath(type)}`;
    if (id) {
      return `${url}/${encodePath(id)}`;
    }
    return url + '?list=true';
  }

  fetchByQuery(query: TransformQuery) {
    const { backend, modelName, id } = query;
    return this.ajax(this.url(backend, modelName, id), 'GET').then((resp: object) => {
      // The API response doesn't explicitly include the name/id, so add it here
      return {
        ...resp,
        backend,
        id,
        name: id,
      };
    });
  }

  query(_store: Store, _type: AdapterModelSchema, query: TransformQuery) {
    return this.fetchByQuery(query);
  }

  queryRecord(_store: Store, type: AdapterModelSchema, query: TransformQuery) {
    return this.ajax(this.url(query.backend, type.modelName, query.id), 'GET').then((result: object) => {
      return {
        id: query.id,
        name: query.id,
        ...result,
      };
    });
  }
}
