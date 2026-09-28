/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model, { attr } from '@ember-data/model';
import lazyCapabilities, { apiPath, type CapabilitiesPathProxy } from 'vault/macros/lazy-capabilities';

import { expandAttributeMeta } from 'vault/utils/field-to-attrs';

export default class ControlGroupConfigModel extends Model {
  @attr({
    defaultValue: 0,
    editType: 'ttl',
    label: 'Maximum TTL',
  })
  declare maxTtl: number;

  @lazyCapabilities(apiPath`sys/config/control-group`) declare configurePath: CapabilitiesPathProxy;

  get canDelete(): boolean {
    return this.configurePath.get('canDelete') ?? false;
  }

  get fields() {
    return expandAttributeMeta(this, ['maxTtl']);
  }
}
