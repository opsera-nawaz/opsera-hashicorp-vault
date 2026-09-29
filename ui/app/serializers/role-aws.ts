/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationSerializer from './application';

interface KeysPayload {
  data: { keys: string[]; [key: string]: unknown };
  backend?: string;
}

interface RoleAwsItem {
  name: string;
  backend?: string;
}

interface NormalizedRoleAwsItems {
  credential_types?: string[];
  credential_type?: string;
  [key: string]: unknown;
}

export default class RoleAwsSerializer extends ApplicationSerializer {
  primaryKey = 'name';

  extractLazyPaginatedData(payload: KeysPayload): RoleAwsItem[] {
    return payload.data.keys.map((key) => {
      const model: RoleAwsItem = {
        name: key,
      };
      if (payload.backend) {
        model.backend = payload.backend;
      }
      return model;
    });
  }

  normalizeItems(payload: Parameters<ApplicationSerializer['normalizeItems']>[0]) {
    const normalized = super.normalizeItems(payload) as NormalizedRoleAwsItems;
    // most roles will only have one in this array,
    // we'll default to the first, and keep the array on the
    // model and show a warning if there's more than one so that
    // they don't inadvertently save
    if (normalized.credential_types) {
      normalized.credential_type = normalized.credential_types[0];
    }
    return normalized;
  }
}
