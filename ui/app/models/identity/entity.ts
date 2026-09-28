/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { hasMany, attr } from '@ember-data/model';
import IdentityModel from './_base';
import apiPath from 'vault/utils/api-path';
import lazyCapabilities from 'vault/macros/lazy-capabilities';

import type { CapabilitiesPathProxy } from 'vault/macros/lazy-capabilities';
import type EntityAliasModel from './entity-alias';

export default class EntityModel extends IdentityModel {
  get formFields(): string[] {
    return ['name', 'disabled', 'policies', 'metadata'];
  }

  @attr('string') declare name: string | undefined;
  @attr('boolean', {
    defaultValue: false,
    label: 'Disable entity',
    helpText: 'All associated tokens cannot be used, but are not revoked.',
  })
  declare disabled: boolean;
  @attr() declare mergedEntityIds: string[] | undefined;
  @attr({
    editType: 'kv',
    isSectionHeader: true,
  })
  declare metadata: Record<string, string> | undefined;
  @attr({
    editType: 'yield',
    isSectionHeader: true,
  })
  declare policies: string[] | undefined;
  @attr('string', {
    readOnly: true,
  })
  declare creationTime: string | undefined;
  @attr('string', {
    readOnly: true,
  })
  declare lastUpdateTime: string | undefined;
  @hasMany('identity/entity-alias', { async: false, readOnly: true, inverse: 'entity' })
  declare aliases: EntityAliasModel[];
  @attr({
    readOnly: true,
  })
  declare groupIds: string[] | undefined;
  @attr({
    readOnly: true,
  })
  declare directGroupIds: string[] | undefined;
  @attr({
    readOnly: true,
  })
  declare inheritedGroupIds: string[] | undefined;

  @lazyCapabilities(apiPath`identity/entity/id/${'id'}`, 'id') declare updatePath: CapabilitiesPathProxy;
  get canDelete(): boolean {
    return this.updatePath.get('canDelete') ?? false;
  }
  get canEdit(): boolean {
    return this.updatePath.get('canUpdate') ?? false;
  }
  get canRead(): boolean {
    return this.updatePath.get('canRead') ?? false;
  }

  @lazyCapabilities(apiPath`identity/entity-alias`) declare aliasPath: CapabilitiesPathProxy;
  get canAddAlias(): boolean {
    return this.aliasPath.get('canCreate') ?? false;
  }

  @lazyCapabilities(apiPath`sys/policies`) declare policyPath: CapabilitiesPathProxy;
  get canCreatePolicies(): boolean {
    return this.policyPath.get('canCreate') ?? false;
  }
}
