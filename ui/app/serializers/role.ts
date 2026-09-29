/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationSerializer from './application';

interface RoleKeyInfo {
  key_type?: string;
  zero_address?: boolean;
  [key: string]: unknown;
}

interface RolePayload {
  zero_address_roles?: string[];
  backend?: string;
  data: {
    key_info?: Record<string, RoleKeyInfo>;
    keys: string[];
    [key: string]: unknown;
  };
}

interface RoleItem {
  name: string;
  backend?: string;
  key_type?: string;
  zero_address?: boolean;
}

export default class RoleSerializer extends ApplicationSerializer {
  primaryKey = 'name';

  // Used for role-ssh
  extractLazyPaginatedData(payload: RolePayload): RoleItem[] {
    if (payload.zero_address_roles) {
      payload.zero_address_roles.forEach((role) => {
        // mutate key_info object to add zero_address info
        const keyInfo = payload.data.key_info?.[role];
        if (keyInfo) {
          keyInfo.zero_address = true;
        }
      });
    }
    if (!payload.data.key_info) {
      return payload.data.keys.map((key) => {
        const model: RoleItem = {
          name: key,
        };
        if (payload.backend) {
          model.backend = payload.backend;
        }
        return model;
      });
    }

    const ret = payload.data.keys.map((key) => {
      const model: RoleItem = {
        name: key,
        key_type: payload.data.key_info?.[key]?.key_type,
        zero_address: payload.data.key_info?.[key]?.zero_address,
      };
      if (payload.backend) {
        model.backend = payload.backend;
      }
      return model;
    });
    delete payload.data.key_info;
    return ret;
  }
}
