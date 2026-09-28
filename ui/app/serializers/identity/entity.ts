/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { EmbeddedRecordsMixin } from '@ember-data/serializer/rest';
import IdentitySerializer, { type RawIdentityListResponse, type RawIdentityEntityKeyInfo } from './_base';

type NormalizedEntityKeyInfo = RawIdentityEntityKeyInfo & { id: string; backend?: string };

// `EmbeddedRecordsMixin` mixes new prototype methods onto the serializer at runtime the
// same way it always has; `.extend()` (rather than native `class ... extends`) is kept
// here because `@types/ember-data` models the mixin as a plain class instead of an
// `Ember.Mixin<T, B>`, which breaks native-class static-side inference when composed
// with a further subclass. Using `.extend()` directly avoids that mismatch while still
// giving every method below an explicit, checked signature.
export default IdentitySerializer.extend(EmbeddedRecordsMixin, {
  // we don't need to serialize relationships here
  serializeHasMany(): void {},

  attrs: {
    aliases: { embedded: 'always' },
  },

  extractLazyPaginatedData(
    payload: RawIdentityListResponse<RawIdentityEntityKeyInfo>
  ): NormalizedEntityKeyInfo[] {
    return (payload.data?.keys as string[]).map((key) => {
      // key_info is expected to contain an entry for every id in `keys`; a non-null
      // assertion preserves the original untyped behavior (throw on a missing entry)
      // rather than introducing a new guard that would change runtime behavior.
      const model = payload.data?.key_info?.[key]! as NormalizedEntityKeyInfo;
      model.id = key;
      if (payload.backend) {
        model.backend = payload.backend;
      }
      return model;
    });
  },
});
