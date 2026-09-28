/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { belongsTo, attr } from '@ember-data/model';
import IdentityModel from './_base';
import lazyCapabilities, { apiPath } from 'vault/macros/lazy-capabilities';
import identityCapabilities from 'vault/macros/identity-capabilities';

import type { CapabilitiesPathProxy } from 'vault/macros/lazy-capabilities';
import type GroupAliasModel from './group-alias';

export default class GroupModel extends IdentityModel {
  get formFields(): string[] {
    const fields = ['name', 'type', 'policies', 'metadata'];
    if (this.type === 'internal') {
      return fields.concat(['memberGroupIds', 'memberEntityIds']);
    }
    return fields;
  }

  @attr('string') declare name: string | undefined;
  @attr('string', {
    defaultValue: 'internal',
    possibleValues: ['internal', 'external'],
  })
  declare type: string;
  @attr('string', {
    readOnly: true,
  })
  declare creationTime: string | undefined;
  @attr('string', {
    readOnly: true,
  })
  declare lastUpdateTime: string | undefined;
  @attr('number', {
    readOnly: true,
  })
  declare numMemberEntities: number | undefined;
  @attr('number', {
    readOnly: true,
  })
  declare numParentGroups: number | undefined;
  @attr('object', {
    editType: 'kv',
    isSectionHeader: true,
  })
  declare metadata: Record<string, unknown> | undefined;
  @attr({
    editType: 'yield',
    isSectionHeader: true,
  })
  declare policies: string[] | undefined;
  @attr({
    label: 'Member Group IDs',
    editType: 'searchSelect',
    isSectionHeader: true,
    fallbackComponent: 'string-list',
    models: ['identity/group'],
  })
  declare memberGroupIds: string[] | undefined;
  @attr({
    label: 'Parent Group IDs',
    editType: 'searchSelect',
    isSectionHeader: true,
    fallbackComponent: 'string-list',
    models: ['identity/group'],
  })
  declare parentGroupIds: string[] | undefined;
  @attr({
    label: 'Member Entity IDs',
    editType: 'searchSelect',
    isSectionHeader: true,
    fallbackComponent: 'string-list',
    models: ['identity/entity'],
  })
  declare memberEntityIds: string[] | undefined;

  get hasMembers(): boolean {
    const { memberEntityIds, memberGroupIds } = this;
    const numEntities = (memberEntityIds && memberEntityIds.length) || 0;
    const numGroups = (memberGroupIds && memberGroupIds.length) || 0;
    return numEntities + numGroups > 0;
  }

  @lazyCapabilities(apiPath`sys/policies`) declare policyPath: CapabilitiesPathProxy;
  get canCreatePolicies(): boolean {
    return this.policyPath.get('canCreate') ?? false;
  }

  @belongsTo('identity/group-alias', { async: false, readOnly: true, inverse: 'group' })
  declare alias: GroupAliasModel;

  @identityCapabilities() declare updatePath: CapabilitiesPathProxy;
  get canDelete(): boolean {
    return this.updatePath.get('canDelete') ?? false;
  }
  get canEdit(): boolean {
    return this.updatePath.get('canUpdate') ?? false;
  }

  @lazyCapabilities(apiPath`identity/group-alias`) declare aliasPath: CapabilitiesPathProxy;
  get canAddAlias(): boolean {
    return this.aliasPath.get('canCreate') ?? false;
  }
}
