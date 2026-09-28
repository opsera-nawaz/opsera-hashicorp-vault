/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import IdentitySerializer, { type RawIdentityListResponse, type RawIdentityAliasKeyInfo } from './_base';

type NormalizedAliasKeyInfo = RawIdentityAliasKeyInfo & { id: string; backend?: string };

export default class EntityAliasSerializer extends IdentitySerializer {
  extractLazyPaginatedData(
    payload: RawIdentityListResponse<RawIdentityAliasKeyInfo>
  ): NormalizedAliasKeyInfo[] {
    return (payload.data?.keys as string[]).map((key) => {
      // key_info is expected to contain an entry for every id in `keys`; a non-null
      // assertion preserves the original untyped behavior (throw on a missing entry)
      // rather than introducing a new guard that would change runtime behavior.
      const model = payload.data?.key_info?.[key]! as NormalizedAliasKeyInfo;
      model.id = key;
      if (payload.backend) {
        model.backend = payload.backend;
      }
      return model;
    });
  }
}
