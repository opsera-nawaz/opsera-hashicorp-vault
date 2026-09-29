/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationAdapter from '../application';

import type Store from '@ember-data/store';
import type { AdapterModelSchema, AdapterSnapshot, AdapterSerializer } from '../-types';

export default class DatabaseConnectionAdapter extends ApplicationAdapter {
  namespace = 'v1';

  urlFor(backend: string, id?: string, type = ''): string {
    if (type === 'ROTATE') {
      return `${this.buildURL()}/${backend}/rotate-root/${id}`;
    } else if (type === 'RESET') {
      return `${this.buildURL()}/${backend}/reset/${id}`;
    }
    let url = `${this.buildURL()}/${backend}/config`;
    if (id) {
      url = `${this.buildURL()}/${backend}/config/${id}`;
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
  fetchByQuery(_store: Store, query: { backend: string; id?: string }) {
    const { backend, id } = query;
    return this.ajax(this.urlFor(backend, id), 'GET', this.optionsForQuery(id)).then(
      (resp: Record<string, unknown>) => {
        resp['backend'] = backend;
        if (id) {
          resp['id'] = id;
        }
        return resp;
      }
    );
  }
  query(store: Store, _type: AdapterModelSchema, query: { backend: string; id?: string }) {
    return this.fetchByQuery(store, query);
  }

  queryRecord(store: Store, _type: AdapterModelSchema, query: { backend: string; id?: string }) {
    return this.fetchByQuery(store, query);
  }

  // @ts-expect-error - concrete override of RESTAdapter's generic createRecord<K>; this codebase's
  // adapters consistently override with concrete (non-generic) params, see app/adapters/-types.ts.
  createRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const serializer = store.serializerFor(type.modelName as never) as AdapterSerializer;
    const data = serializer.serialize(snapshot) as Record<string, unknown>;
    const id = snapshot.attr('name') as string;
    const backend = snapshot.attr('backend') as string;

    return this.ajax(this.urlFor(backend, id), 'POST', { data }).then(() => {
      // ember data doesn't like 204s if it's not a DELETE
      return {
        data: {
          id,
          name: id,
          ...data,
        },
      };
    });
  }

  // @ts-expect-error - see createRecord above
  updateRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    return this.createRecord(store, type, snapshot);
  }

  // @ts-expect-error - see createRecord above
  deleteRecord(_store: Store, _type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const id = snapshot.id;
    const backend = snapshot.attr('backend') as string;
    return this.ajax(this.urlFor(backend, id), 'DELETE');
  }

  rotateRootCredentials(backend: string, id: string) {
    return this.ajax(this.urlFor(backend, id, 'ROTATE'), 'POST');
  }

  resetConnection(backend: string, id: string) {
    return this.ajax(this.urlFor(backend, id, 'RESET'), 'POST');
  }
}
