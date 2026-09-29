/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationAdapter from './application';

import type Store from '@ember-data/store';
import type { AdapterModelSchema, AdapterSnapshot, AdapterSerializer } from './-types';

export default class PolicyAdapter extends ApplicationAdapter {
  namespace = 'v1/sys';
  pathForType(type: string): string {
    const path = type.replace('policy', 'policies');
    return path;
  }

  createOrUpdate(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const serializer = store.serializerFor(type.modelName as never) as AdapterSerializer;
    const data = serializer.serialize(snapshot);
    const name = snapshot.attr('name');

    return this.ajax(this.buildURL(type.modelName as never, name as string), 'PUT', { data }).then(() => {
      // doing this to make it like a Vault response - ember data doesn't like 204s if it's not a DELETE
      const serializeSnapshot = (this as unknown as { serialize: (snapshot: AdapterSnapshot) => object })
        .serialize;
      return {
        data: { ...serializeSnapshot(snapshot), id: name },
      };
    });
  }

  // @ts-expect-error - concrete override of RESTAdapter's generic createRecord<K>; this codebase's
  // adapters consistently override with concrete (non-generic) params.
  createRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    return this.createOrUpdate(store, type, snapshot);
  }

  // @ts-expect-error - see createRecord above
  updateRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    return this.createOrUpdate(store, type, snapshot);
  }

  query(_store: Store, type: AdapterModelSchema) {
    return this.ajax(this.buildURL(type.modelName as never), 'GET', {
      data: { list: true },
    });
  }
}
