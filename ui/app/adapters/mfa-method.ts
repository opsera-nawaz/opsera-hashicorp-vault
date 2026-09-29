/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationAdapter from './application';

import type Store from '@ember-data/store';
import type { AdapterModelSchema, AdapterSnapshot, AdapterSerializer } from './-types';

export default class MfaMethodAdapter extends ApplicationAdapter {
  namespace = 'v1';

  pathForType(): string {
    return 'identity/mfa/method';
  }

  createOrUpdate(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const data = (store.serializerFor(type.modelName as never) as AdapterSerializer).serialize(
      snapshot
    ) as Record<string, unknown>;
    const { id } = snapshot;
    return this.ajax(this.buildURL(type.modelName, id, snapshot, 'POST'), 'POST', {
      data,
    }).then((res: { data?: { method_id?: string } } | undefined) => {
      // TODO: Check how 204's are handled by ember
      return {
        data: {
          ...data,
          id: res?.data?.method_id || id,
        },
      };
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

  // @ts-expect-error - concrete override of RESTAdapter's generic urlForDeleteRecord<K>; this
  // codebase's adapters consistently override with concrete (non-generic) params.
  urlForDeleteRecord(id: string, modelName: string, snapshot: AdapterSnapshot): string {
    return this.buildURL(modelName, id, snapshot, 'POST');
  }

  // @ts-expect-error - concrete override of RESTAdapter's generic query<K>; this codebase's
  // adapters consistently override with concrete (non-generic) params.
  query(store: Store, type: AdapterModelSchema, query: object) {
    const url = this.urlForQuery(query, type.modelName as never);
    return this.ajax(url, 'GET', {
      data: {
        list: true,
      },
    });
  }

  // @ts-expect-error - concrete override of RESTAdapter's generic buildURL<K>; this codebase's
  // adapters consistently override with concrete (non-generic) params.
  buildURL(
    modelName?: string,
    id?: string | unknown[] | Record<string, unknown> | null,
    snapshot?: AdapterSnapshot | unknown[] | null,
    requestType?: string,
    query?: object
  ): string {
    if (requestType === 'POST' && snapshot && !Array.isArray(snapshot)) {
      const url = `${super.buildURL(modelName as never)}/${snapshot.attr('type')}`;
      return id ? `${url}/${id}` : url;
    }
    return super.buildURL(modelName as never, id, snapshot as never, requestType, query);
  }
}
