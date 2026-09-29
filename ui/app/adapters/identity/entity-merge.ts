/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import IdentityAdapter from './base';

import type Store from '@ember-data/store';
import type { AdapterModelSchema, AdapterSnapshot } from '../-types';

export default class EntityMergeAdapter extends IdentityAdapter {
  buildURL(
    _modelName?: string,
    id?: string | unknown[] | Record<string, unknown> | null,
    snapshot?: unknown[] | null,
    requestType?: string,
    query?: object
  ): string {
    // first arg is modelName which we're hardcoding in the call to super.
    return super.buildURL('identity/entity/merge', id, snapshot, requestType, query);
  }

  // @ts-expect-error - concrete override of RESTAdapter's generic createRecord<K>; this codebase's
  // adapters consistently override with concrete (non-generic) params, see app/adapters/-types.ts.
  createRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    return super.createRecord(store, type as never, snapshot as never).then(() => {
      // return the `to` id here so we can redirect to it on success
      // (and because ember _loves_ 204s for createRecord)
      return { id: snapshot.attr('toEntityId') };
    });
  }
}
