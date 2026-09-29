/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import RESTSerializer from '@ember-data/serializer/rest';
import { decamelize } from '@ember/string';

import type Store from '@ember-data/store';
import type { ModelSchema } from 'ember-data'; // eslint-disable-line ember/use-ember-data-rfc-395-imports
import type { AdapterSnapshot } from 'vault/adapters/-types';

interface TransitKeyPayload {
  data: {
    keys?: string[] | Record<string, number>;
    [key: string]: unknown;
  };
  backend?: string;
  type?: string;
  id?: string;
  name?: string;
}

export default class TransitKeySerializer extends RESTSerializer {
  primaryKey = 'name';

  keyForAttribute(attr: string): string {
    return decamelize(attr);
  }

  normalizeSecrets(payload: TransitKeyPayload) {
    if (Array.isArray(payload.data.keys)) {
      const secrets = payload.data.keys.map((secret) => ({ name: secret, backend: payload.backend }));
      return secrets;
    }
    Object.assign(payload, payload.data);
    delete (payload as { data?: unknown }).data;
    // timestamps for these two are in seconds...
    if (
      payload.type === 'aes256-gcm96' ||
      payload.type === 'chacha20-poly1305' ||
      payload.type === 'aes128-gcm96'
    ) {
      const keys = (payload as unknown as Record<string, unknown>)['keys'] as
        | Record<string, number>
        | undefined;
      if (keys) {
        for (const version in keys) {
          keys[version] = keys[version]! * 1000;
        }
      }
    }
    payload.id = payload.name;
    return [payload];
  }

  normalizeResponse(
    store: Store,
    primaryModelClass: ModelSchema,
    payload: TransitKeyPayload,
    id: string | number,
    requestType: string
  ) {
    const nullResponses = ['updateRecord', 'createRecord', 'deleteRecord'];
    const secrets = nullResponses.includes(requestType)
      ? { name: id, backend: payload.backend }
      : this.normalizeSecrets(payload);
    const { modelName } = primaryModelClass;
    let transformedPayload: Record<string, unknown> = { [modelName]: secrets };
    // just return the single object because ember is picky
    if (requestType === 'queryRecord' && Array.isArray(secrets)) {
      transformedPayload = { [modelName]: secrets[0] };
    }

    return super.normalizeResponse(store, primaryModelClass, transformedPayload, id, requestType);
  }

  // @ts-expect-error - concrete override of RESTSerializer's generic serialize<K>; the loose
  // AdapterSnapshot stand-in isn't assignable to Snapshot<K>.
  serialize(snapshot: AdapterSnapshot, requestType?: string) {
    if (requestType === 'update') {
      const min_decryption_version = snapshot.attr('minDecryptionVersion');
      const min_encryption_version = snapshot.attr('minEncryptionVersion');
      const deletion_allowed = snapshot.attr('deletionAllowed');
      const auto_rotate_period = snapshot.attr('autoRotatePeriod');
      return {
        min_decryption_version,
        min_encryption_version,
        deletion_allowed,
        auto_rotate_period,
      };
    } else {
      snapshot.id = snapshot.attr('name') as string;
      return super.serialize(snapshot as never, requestType as never);
    }
  }
}
