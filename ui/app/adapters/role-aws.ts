/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationAdapter from './application';
import { encodePath } from 'vault/utils/path-encoding-helpers';

import type Store from '@ember-data/store';
import type { AdapterModelSchema, AdapterSnapshot, AdapterSerializer } from './-types';

export default class RoleAwsAdapter extends ApplicationAdapter {
  namespace = 'v1';

  createOrUpdate(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot, requestType?: string) {
    const { name, backend } = snapshot.record as unknown as { name: string; backend: string };
    const serializer = store.serializerFor(type.modelName as never) as AdapterSerializer;
    const data = serializer.serialize(snapshot, requestType) as Record<string, unknown>;
    const url = this.urlForRole(backend, name);

    return this.ajax(url, 'POST', { data }).then((resp: { data?: Record<string, unknown> } | undefined) => {
      // Ember data doesn't like 204 responses except for DELETE method
      const response = resp || { data: {} };
      response.data!['name'] = name;
      response.data!['backend'] = name;
      return response;
    });
  }

  // @ts-expect-error - concrete override of RESTAdapter's generic createRecord<K>; this codebase's
  // adapters consistently override with concrete (non-generic) params, see app/adapters/-types.ts.
  createRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    return this.createOrUpdate(store, type, snapshot);
  }

  // @ts-expect-error - see createRecord above
  updateRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    return this.createOrUpdate(store, type, snapshot, 'update');
  }

  // @ts-expect-error - see createRecord above
  deleteRecord(_store: Store, _type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const { id } = snapshot;
    const record = snapshot.record as unknown as { backend: string };
    return this.ajax(this.urlForRole(record.backend, id), 'DELETE');
  }

  pathForType(): string {
    return 'roles';
  }

  urlForRole(backend: string, id?: string): string {
    let url = `${this.buildURL()}/${encodePath(backend)}/roles`;
    if (id) {
      url = url + '/' + encodePath(id);
    }
    return url;
  }

  optionsForQuery(id?: string) {
    const data: Record<string, unknown> = {};
    if (!id) {
      data['list'] = true;
    }
    return { data };
  }

  fetchByQuery(_store: Store, query: { id?: string; backend: string }) {
    const { id, backend } = query;
    return this.ajax(this.urlForRole(backend, id), 'GET', this.optionsForQuery(id)).then((resp: object) => {
      const data = {
        id,
        name: id,
        backend,
      };

      return { ...resp, ...data };
    });
  }

  query(store: Store, _type: AdapterModelSchema, query: { id?: string; backend: string }) {
    return this.fetchByQuery(store, query);
  }

  queryRecord(store: Store, _type: AdapterModelSchema, query: { id?: string; backend: string }) {
    return this.fetchByQuery(store, query);
  }
}
