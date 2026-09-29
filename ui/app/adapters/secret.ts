/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { isEmpty } from '@ember/utils';
import ApplicationAdapter from './application';
import { encodePath } from 'vault/utils/path-encoding-helpers';

import type Store from '@ember-data/store';
import type { AdapterModelSchema, AdapterSnapshot, AdapterSerializer } from './-types';

export default class SecretAdapter extends ApplicationAdapter {
  namespace = 'v1';

  createOrUpdate(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const serializer = store.serializerFor(type.modelName as never) as AdapterSerializer;
    const data = serializer.serialize(snapshot) as Record<string, unknown>;
    const { id } = snapshot;
    const path = (snapshot.record as unknown as { path?: string }).path;
    return this.ajax(this.urlForSecret(snapshot.attr('backend') as string, path || id), 'POST', {
      data,
    }).then(() => {
      data['id'] = path || id;
      return data;
    });
  }

  // @ts-expect-error - concrete override of RESTAdapter's generic createRecord<K>; this codebase's
  // adapters consistently override with concrete (non-generic) params, see app/adapters/-types.ts.
  createRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    return this.createOrUpdate(store, type, snapshot);
  }

  // @ts-expect-error - see createRecord above
  updateRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    return this.createOrUpdate(store, type, snapshot);
  }

  // @ts-expect-error - see createRecord above
  deleteRecord(_store: Store, _type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const { id } = snapshot;
    return this.ajax(this.urlForSecret(snapshot.attr('backend') as string, id), 'DELETE');
  }

  urlForSecret(backend: string, id?: string): string {
    let url = `${this.buildURL()}/${encodePath(backend)}/`;
    if (!isEmpty(id)) {
      url = url + encodePath(id);
    }

    return url;
  }

  pathForType(): string {
    return 'mounts';
  }

  optionsForQuery(_id: string | undefined, action?: string, wrapTTL?: string) {
    const data: Record<string, unknown> = {};
    if (action === 'query') {
      data['list'] = true;
    }
    if (wrapTTL) {
      return { data, wrapTTL };
    }
    return { data };
  }

  fetchByQuery(query: { id?: string; backend: string; wrapTTL?: string }, action?: string) {
    const { id, backend, wrapTTL } = query;
    return this.ajax(this.urlForSecret(backend, id), 'GET', this.optionsForQuery(id, action, wrapTTL)).then(
      (resp: Record<string, unknown>) => {
        if (wrapTTL) {
          return resp;
        }
        resp['id'] = id;
        resp['backend'] = backend;
        return resp;
      }
    );
  }

  query(_store: Store, _type: AdapterModelSchema, query: { id?: string; backend: string; wrapTTL?: string }) {
    return this.fetchByQuery(query, 'query');
  }

  queryRecord(
    _store: Store,
    _type: AdapterModelSchema,
    query: { id?: string; backend: string; wrapTTL?: string }
  ) {
    return this.fetchByQuery(query, 'queryRecord');
  }
}
