/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationSerializer from './application';

import type { ModelSchema } from 'ember-data'; // eslint-disable-line ember/use-ember-data-rfc-395-imports

type Destination = 'model' | 'server';

const KEYS: Record<Destination, string[]> = {
  model: ['mfa_methods', 'identity_entities', 'identity_groups'],
  server: ['mfa_method_ids', 'identity_entity_ids', 'identity_group_ids'],
};

interface MfaLoginEnforcementPayload {
  data?: {
    keys?: string[];
    key_info?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export default class MfaLoginEnforcementSerializer extends ApplicationSerializer {
  primaryKey = 'name';

  // Return data with updated keys for hasMany relationships with ids in the name
  transformHasManyKeys(data: Record<string, unknown>, destination: Destination): Record<string, unknown> {
    KEYS[destination].forEach((newKey, index) => {
      const oldKey = destination === 'model' ? KEYS.server[index] : KEYS.model[index];
      const merged = Object.assign(data, { [newKey]: oldKey ? data[oldKey] : undefined });
      if (oldKey) {
        delete merged[oldKey];
      }
    });
    return data;
  }
  normalize(model: ModelSchema, data: Record<string, unknown>): {} {
    this.transformHasManyKeys(data, 'model');
    return super.normalize(model, data);
  }
  normalizeItems(payload: MfaLoginEnforcementPayload): unknown {
    if (payload.data) {
      if (payload.data?.keys && Array.isArray(payload.data.keys)) {
        return payload.data.keys.map((key) => (payload.data?.key_info as Record<string, unknown>)?.[key]);
      }
      Object.assign(payload, payload.data);
      delete payload.data;
    }
    return payload;
  }
  serialize(...args: Parameters<ApplicationSerializer['serialize']>) {
    const json = super.serialize(...args) as Record<string, unknown>;
    // empty arrays are being removed from serialized json
    // ensure that they are sent to the server, otherwise removing items will not be persisted
    json['auth_method_accessors'] = json['auth_method_accessors'] || [];
    json['auth_method_types'] = json['auth_method_types'] || [];
    // TODO: create array transform which serializes an empty array if empty
    return this.transformHasManyKeys(json, 'server');
  }
}
