/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationAdapter from './application';

import type Store from '@ember-data/store';
import type { AdapterModelSchema, AdapterSnapshot, AdapterSerializer } from './-types';

export default class KeymgmtKeyAdapter extends ApplicationAdapter {
  namespace = 'v1';

  pathForType(): string {
    return 'identity/mfa/login-enforcement';
  }

  _saveRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const { modelName } = type;
    const data = (store.serializerFor(modelName as never) as AdapterSerializer).serialize(snapshot);
    return this.ajax(
      this.urlForUpdateRecord(snapshot.attr('name') as string, modelName as never, snapshot as never),
      'POST',
      {
        data,
      }
    ).then(() => data);
  }
  // create does not return response similar to PUT request
  // @ts-expect-error - concrete override of RESTAdapter's generic createRecord<K>; this codebase's
  // adapters consistently override with concrete (non-generic) params, see app/adapters/-types.ts.
  createRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    return this._saveRecord(store, type, snapshot);
  }
  // update record via POST method
  // @ts-expect-error - see createRecord above
  updateRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    return this._saveRecord(store, type, snapshot);
  }

  // @ts-expect-error - concrete override of RESTAdapter's generic query<K>; this codebase's
  // adapters consistently override with concrete (non-generic) params.
  query(store: Store, type: AdapterModelSchema, query: object) {
    const url = this.urlForQuery(query, type.modelName as never);
    return this.ajax(url, 'GET', { data: { list: true } });
  }
}
