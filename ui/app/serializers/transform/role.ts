/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationSerializer from '../application';

interface KeysPayload {
  data: { keys: string[]; [key: string]: unknown };
  backend?: string;
}

interface RoleItem {
  id: string;
  name: string;
  backend?: string;
}

export default class TransformRoleSerializer extends ApplicationSerializer {
  primaryKey = 'name';

  extractLazyPaginatedData(payload: KeysPayload): RoleItem[] {
    return payload.data.keys.map((key) => {
      const model: RoleItem = {
        id: key,
        name: key,
      };
      if (payload.backend) {
        model.backend = payload.backend;
      }
      return model;
    });
  }
}
