/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import RESTSerializer from '@ember-data/serializer/rest';

import type Store from '@ember-data/store';
import type { ModelSchema } from 'ember-data'; // eslint-disable-line ember/use-ember-data-rfc-395-imports

interface CredentialPayload {
  data?: {
    username?: string;
    password?: string;
    rsa_private_key?: string;
    last_vault_rotation?: string;
    rotation_period?: number;
    ttl?: number;
    [key: string]: unknown;
  };
  lease_id?: string;
  lease_duration?: number;
  roleType?: string;
}

export default class DatabaseCredentialSerializer extends RESTSerializer {
  primaryKey = 'username';

  normalizePayload(payload: CredentialPayload) {
    if (payload.data) {
      return {
        username: payload.data.username,
        password: payload.data.password,
        rsaPrivateKey: payload.data.rsa_private_key,
        leaseId: payload.lease_id,
        leaseDuration: payload.lease_duration,
        lastVaultRotation: payload.data.last_vault_rotation,
        rotationPeriod: payload.data.rotation_period,
        ttl: payload.data.ttl,
        // roleType is added on adapter
        roleType: payload.roleType,
      };
    }
    return undefined;
  }

  normalizeResponse(
    store: Store,
    primaryModelClass: ModelSchema,
    payload: CredentialPayload,
    id: string | number,
    requestType: string
  ) {
    const credentials = this.normalizePayload(payload);
    const { modelName } = primaryModelClass;
    const transformedPayload = { [modelName]: credentials };

    return super.normalizeResponse(store, primaryModelClass, transformedPayload, id, requestType);
  }
}
