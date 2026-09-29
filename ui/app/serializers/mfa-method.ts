/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationSerializer from './application';

import type { AdapterSnapshot } from 'vault/adapters/-types';

interface MfaMethodPayload {
  data?: {
    keys?: string[];
    key_info?: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export default class KeymgmtKeySerializer extends ApplicationSerializer {
  normalizeItems(payload: MfaMethodPayload): unknown {
    if (!payload?.data) return payload;
    if (payload.data.keys && Array.isArray(payload.data.keys)) {
      const data = payload.data.keys.map((key) => {
        const model = payload.data?.key_info?.[key] as Record<string, unknown>;
        model['id'] = key;
        return model;
      });
      return data;
    }
    Object.assign(payload, payload.data);
    delete payload.data;
    return payload;
  }
  // @ts-expect-error - concrete override of JSONSerializer's generic serialize<K>; the loose
  // AdapterSnapshot stand-in (see app/adapters/-types.ts) isn't assignable to Snapshot<K>.
  serialize(snapshot: AdapterSnapshot, options?: object) {
    const json = super.serialize(snapshot as never, options ?? {}) as Record<string, unknown>;
    delete json['type'];
    return json;
  }
}
