/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model, { hasMany, belongsTo, attr } from '@ember-data/model';
import lazyCapabilities, { apiPath, type CapabilitiesPathProxy } from 'vault/macros/lazy-capabilities';

import type IdentityEntityModel from 'vault/models/identity/entity';

export default class ControlGroupModel extends Model {
  @attr('boolean') declare approved: boolean | undefined;
  @attr('string') declare requestPath: string | undefined;
  @belongsTo('identity/entity', { async: false, inverse: null }) declare requestEntity: IdentityEntityModel;
  @hasMany('identity/entity', { async: false, inverse: null }) declare authorizations: IdentityEntityModel[];

  @lazyCapabilities(apiPath`sys/control-group/authorize`) declare authorizePath: CapabilitiesPathProxy;
  get canAuthorize(): boolean {
    return this.authorizePath.get('canUpdate') ?? false;
  }

  @lazyCapabilities(apiPath`sys/config/control-group`) declare configurePath: CapabilitiesPathProxy;
  get canConfigure(): boolean {
    return this.configurePath.get('canUpdate') ?? false;
  }
}
