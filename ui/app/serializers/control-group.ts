/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { EmbeddedRecordsMixin } from '@ember-data/serializer/rest';
import ApplicationSerializer from './application';

import type Store from '@ember-data/store';
import type { ModelSchema } from 'ember-data'; // eslint-disable-line ember/use-ember-data-rfc-395-imports
import type { AdapterSnapshot } from 'vault/adapters/-types';

interface ControlGroupPayload {
  data?: {
    request_entity?: Record<string, unknown> | null;
    authorizations?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
}

// `_super` is provided by Ember's classic `.extend()` method wrapping at runtime, but the
// `.extend(Mixin, hash)` overload used below doesn't expose it on the hash's inferred `this`
// type, so calls to it are cast through this minimal shape instead.
interface HasSuper {
  _super(...args: unknown[]): unknown;
}

// `EmbeddedRecordsMixin` mixes new prototype methods onto the serializer at runtime the same way
// it always has; `.extend()` (rather than native `class ... extends`) is kept here for the same
// reason documented in app/serializers/identity/entity.ts: `@types/ember-data` models the mixin
// as a plain class rather than an `Ember.Mixin<T, B>`, which breaks native-class static-side
// inference when composed with a further subclass.
export default ApplicationSerializer.extend(EmbeddedRecordsMixin, {
  attrs: {
    requestEntity: { embedded: 'always' },
    authorizations: { embedded: 'always' },
  },

  normalizeResponse(
    store: Store,
    primaryModelClass: ModelSchema,
    payload: ControlGroupPayload,
    id: string | number,
    requestType: string
  ): {} {
    const entity = payload?.data?.['request_entity'];
    if (Array.isArray(payload.data?.authorizations)) {
      for (const authorization of payload.data.authorizations) {
        authorization['id'] = authorization['entity_id'];
        authorization['name'] = authorization['entity_name'];
      }
    }

    if (entity && Object.keys(entity).length === 0) {
      payload.data!['request_entity'] = null;
    }
    return (this as unknown as HasSuper)._super(store, primaryModelClass, payload, id, requestType) as {};
  },

  serialize(snapshot: AdapterSnapshot) {
    return { accessor: snapshot.id };
  },
});
