/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { belongsTo, attr } from '@ember-data/model';
import IdentityModel from './_base';
import identityCapabilities from 'vault/macros/identity-capabilities';

import type { CapabilitiesPathProxy } from 'vault/macros/lazy-capabilities';
import type EntityModel from './entity';

export default class EntityAliasModel extends IdentityModel {
  parentType = 'entity';

  get formFields(): string[] {
    return ['name', 'mountAccessor'];
  }

  @belongsTo('identity/entity', { readOnly: true, async: false, inverse: 'aliases' })
  declare entity: EntityModel;

  @attr('string') declare name: string | undefined;
  @attr('string') declare canonicalId: string | undefined;
  @attr('string', {
    label: 'Auth Backend',
    editType: 'mountAccessor',
  })
  declare mountAccessor: string | undefined;
  @attr({
    editType: 'kv',
    isSectionHeader: true,
  })
  declare metadata: Record<string, string> | undefined;
  @attr('string', {
    readOnly: true,
  })
  declare mountPath: string | undefined;
  @attr('string', {
    readOnly: true,
  })
  declare mountType: string | undefined;
  @attr('string', {
    readOnly: true,
  })
  declare creationTime: string | undefined;
  @attr('string', {
    readOnly: true,
  })
  declare lastUpdateTime: string | undefined;
  @attr() declare mergedFromCanonicalIds: string[] | undefined;

  @identityCapabilities() declare updatePath: CapabilitiesPathProxy;
  get canDelete(): boolean {
    return this.updatePath.get('canDelete') ?? false;
  }
  get canEdit(): boolean {
    return this.updatePath.get('canUpdate') ?? false;
  }
}
