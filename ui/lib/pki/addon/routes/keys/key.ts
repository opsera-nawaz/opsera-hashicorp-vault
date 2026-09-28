/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';

import type ApiService from 'vault/services/api';
import type CapabilitiesService from 'vault/services/capabilities';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type { PkiReadKeyResponse } from '@hashicorp/vault-client-typescript';

export interface KeyRouteModel {
  backend: string;
  key: PkiReadKeyResponse;
  canUpdate: boolean;
  canDelete: boolean;
}

export default class PkiKeyRoute extends Route {
  @service declare readonly secretMountPath: SecretMountPath;
  @service declare readonly api: ApiService;
  @service declare readonly capabilities: CapabilitiesService;

  async model(): Promise<KeyRouteModel> {
    const { key_id: keyId } = this.paramsFor('keys/key') as { key_id: string };
    const backend = this.secretMountPath.currentPath;
    const { canUpdate, canDelete } = await this.capabilities.for('pkiKey', { backend, keyId });
    const key = await this.api.secrets.pkiReadKey(keyId, this.secretMountPath.currentPath);
    return {
      backend,
      key,
      canUpdate,
      canDelete,
    };
  }
}
