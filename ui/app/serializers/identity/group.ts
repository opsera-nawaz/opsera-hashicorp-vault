/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { EmbeddedRecordsMixin } from '@ember-data/serializer/rest';
import IdentitySerializer, { type RawIdentityAliasKeyInfo } from './_base';

import type Store from '@ember-data/store';
import type { Snapshot, ModelSchema } from '@ember-data/serializer/json';

/** Flattened single-record group payload, post `normalizeItems`. */
interface NormalizedGroupPayload {
  alias?: RawIdentityAliasKeyInfo | Record<string, never>;
  [key: string]: unknown;
}

/** Serialized group hash, pre-submission to the API. */
interface SerializedGroupPayload {
  alias?: unknown;
  type?: string;
  member_entity_ids?: unknown;
  member_group_ids?: unknown;
  [key: string]: unknown;
}

// `EmbeddedRecordsMixin` mixes new prototype methods onto the serializer at runtime the
// same way it always has; `.extend()` (rather than native `class ... extends`) is kept
// here because `@types/ember-data` models the mixin as a plain class instead of an
// `Ember.Mixin<T, B>`, which breaks native-class static-side inference when composed
// with a further subclass. Using `.extend()` directly avoids that mismatch while still
// giving every method below an explicit, checked signature.
export default IdentitySerializer.extend(EmbeddedRecordsMixin, {
  attrs: {
    alias: { embedded: 'always' },
  },

  // `this._super(...)` (Ember's classic override hook) can't be typed reliably here
  // because `.extend()`'s `ThisType` inference doesn't carry `CoreObject#_super` through
  // this mixin composition; calling the inherited prototype method directly via `.call`
  // resolves to the exact same implementation `_super` would have dispatched to, since
  // `IdentitySerializer` doesn't itself override these methods.
  normalizeFindRecordResponse(
    store: Store,
    primaryModelClass: ModelSchema,
    payload: NormalizedGroupPayload,
    id: string | number,
    requestType: string
  ): NormalizedGroupPayload {
    if (payload.alias && Object.keys(payload.alias).length === 0) {
      delete payload.alias;
    }
    return IdentitySerializer.prototype.normalizeFindRecordResponse.call(
      this,
      store,
      primaryModelClass,
      payload,
      id,
      requestType
    );
  },

  serialize(snapshot: Snapshot, options: Record<string, unknown>): SerializedGroupPayload {
    const json = IdentitySerializer.prototype.serialize.call(
      this,
      snapshot,
      options
    ) as SerializedGroupPayload;
    delete json.alias;
    if (json.type === 'external') {
      delete json.member_entity_ids;
      delete json.member_group_ids;
    }
    return json;
  },
});
