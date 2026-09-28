/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model, { attr } from '@ember-data/model';
import lazyCapabilities, { apiPath, type CapabilitiesPathProxy } from 'vault/macros/lazy-capabilities';

export default class PolicyModel extends Model {
  @attr('string') declare name: string | undefined;
  @attr('string') declare policy: string | undefined;

  get policyType(): string | undefined {
    return String((this.constructor as typeof PolicyModel).modelName).split('/')[1];
  }

  @lazyCapabilities(apiPath`sys/policies/${'policyType'}/${'id'}`, 'id', 'policyType')
  declare updatePath: CapabilitiesPathProxy;
  get canDelete(): boolean {
    return this.updatePath.get('canDelete') ?? false;
  }
  get canEdit(): boolean {
    return this.updatePath.get('canUpdate') ?? false;
  }
  get canRead(): boolean {
    return this.updatePath.get('canRead') ?? false;
  }

  get format(): 'json' | 'hcl' {
    const policy = this.policy;
    let isJSON = false;
    try {
      const parsed = policy ? JSON.parse(policy) : undefined;
      if (parsed) {
        isJSON = true;
      }
    } catch (e) {
      // can't parse JSON
      isJSON = false;
    }
    return isJSON ? 'json' : 'hcl';
  }
}
