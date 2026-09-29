/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { allSettled } from 'rsvp';
import ApplicationAdapter from './application';
import { encodePath } from 'vault/utils/path-encoding-helpers';

import type Store from '@ember-data/store';
import type { AdapterModelSchema, AdapterSnapshot, AdapterSerializer } from './-types';

export default class TransformAdapter extends ApplicationAdapter {
  namespace = 'v1';

  createOrUpdate(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const { modelName } = type;
    const {
      backend,
      name,
      type: transformType,
    } = snapshot.record as unknown as {
      backend: string;
      name: string;
      type?: string;
    };
    const serializer = store.serializerFor(modelName as never) as AdapterSerializer;
    const data = serializer.serialize(snapshot);
    const url = this.urlForTransformations(backend, name, transformType);

    return this.ajax(url, 'POST', { data }).then((resp: Record<string, unknown> | undefined) => {
      const response: Record<string, unknown> = resp || {};
      response['id'] = name;
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
    return this.createOrUpdate(store, type, snapshot);
  }

  // @ts-expect-error - see createRecord above
  deleteRecord(_store: Store, _type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const { id } = snapshot;
    const record = snapshot.record as unknown as { backend: string };
    return this.ajax(this.urlForTransformations(record.backend, id), 'DELETE');
  }

  pathForType(): string {
    return 'transform';
  }

  urlForTransformations(backend: string, id?: string, type?: string): string {
    const base = `${this.buildURL()}/${encodePath(backend)}`;
    // when type exists, transformations is plural
    const url = type ? `${base}/transformations/${type}` : `${base}/transformation`;
    if (id) return `${url}/${encodePath(id)}`;
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
    const queryAjax = this.ajax(this.urlForTransformations(backend, id), 'GET', this.optionsForQuery(id));

    return allSettled([queryAjax]).then((results) => {
      const [result] = results as [
        { state: string; value?: { data: Record<string, unknown> }; reason?: unknown },
      ];
      // query result 404, so throw the adapterError
      if (result.state === 'rejected' || !result.value) {
        throw result.state === 'rejected' ? result.reason : undefined;
      }
      const resp: { id?: string; name?: string; backend: string; data: Record<string, unknown> } = {
        id,
        name: id,
        backend,
        data: {},
      };

      results.forEach((res) => {
        const settled = res as { state: string; value?: { data: Record<string, unknown> } };
        if (settled.state === 'fulfilled' && settled.value) {
          let d = settled.value.data;
          if (d['templates']) {
            // In Transformations data goes up as "template", but comes down as "templates"
            // To keep the keys consistent we're translating here
            d = {
              ...d,
              template: d['templates'],
            };
            delete d['templates'];
          }
          resp.data = { ...resp.data, ...d };
        }
      });
      return resp;
    });
  }

  query(store: Store, _type: AdapterModelSchema, query: { id?: string; backend: string }) {
    return this.fetchByQuery(store, query);
  }

  queryRecord(store: Store, _type: AdapterModelSchema, query: { id?: string; backend: string }) {
    return this.fetchByQuery(store, query);
  }
}
