/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

// This model represents the capabilities on a given `path`
// `path` is also the primaryId
// https://developer.hashicorp.com/vault/docs/concepts/policies#capabilities

import Model, { attr } from '@ember-data/model';

const SUDO_PATHS = [
  'sys/seal',
  'sys/replication/performance/primary/secondary-token',
  'sys/replication/dr/primary/secondary-token',
  'sys/replication/reindex',
  'sys/leases/lookup/',
];

const SUDO_PATH_PREFIXES = ['sys/leases/revoke-prefix', 'sys/leases/revoke-force'];

export { SUDO_PATHS, SUDO_PATH_PREFIXES };

export default class CapabilitiesModel extends Model {
  @attr('string') declare path: string;
  @attr('array') declare capabilities: string[] | undefined;
  @attr() declare allowedParameters: Record<string, unknown> | undefined;
  @attr() declare deniedParameters: Record<string, unknown> | undefined;

  hasCapability(capability: string): boolean {
    const { capabilities, path } = this;
    if (!capabilities) {
      return false;
    }
    if (capabilities.includes('root')) {
      return true;
    }
    if (capabilities.includes('deny')) {
      return false;
    }
    // if the path is sudo protected, they'll need sudo + the appropriate capability
    if (SUDO_PATHS.includes(path) || SUDO_PATH_PREFIXES.find((item) => path.startsWith(item))) {
      return capabilities.includes('sudo') && capabilities.includes(capability);
    }
    return capabilities.includes(capability);
  }

  get canCreate(): boolean {
    return this.hasCapability('create');
  }
  get canDelete(): boolean {
    return this.hasCapability('delete');
  }
  get canList(): boolean {
    return this.hasCapability('list');
  }
  get canPatch(): boolean {
    return this.hasCapability('patch');
  }
  get canRead(): boolean {
    return this.hasCapability('read');
  }
  get canSudo(): boolean {
    return this.hasCapability('sudo');
  }
  get canUpdate(): boolean {
    return this.hasCapability('update');
  }
}
