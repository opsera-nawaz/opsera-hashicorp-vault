/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model, { attr } from '@ember-data/model';
import lazyCapabilities, { apiPath, type CapabilitiesPathProxy } from 'vault/macros/lazy-capabilities';
import { expandAttributeMeta } from 'vault/utils/field-to-attrs';

import type { FormField } from 'vault/app-types';

export default class TransformRoleModel extends Model {
  // used for getting appropriate options for backend
  idPrefix = 'role/';
  // the id prefixed with `role/` so we can use it as the *secret param for the secret show route
  get idForNav(): string {
    const modelId = this.id || '';
    return `${this.idPrefix}${modelId}`;
  }

  @attr('string', {
    // TODO: make this required for making a transformation
    label: 'Name',
    readOnly: true,
    subText: 'The name for your role. This cannot be edited later.',
  })
  declare name: string | undefined;

  @attr('array', {
    editType: 'searchSelect',
    isSectionHeader: true,
    fallbackComponent: 'string-list',
    label: 'Transformations',
    models: ['transform'],
    onlyAllowExisting: true,
    subText: 'Select which transformations this role will have access to. It must already exist.',
  })
  declare transformations: string[] | undefined;

  get attrs(): FormField[] {
    const keys = ['name', 'transformations'];
    return expandAttributeMeta(this, keys);
  }

  @attr('string', { readOnly: true }) declare backend: string | undefined;

  @lazyCapabilities(apiPath`${'backend'}/role/${'id'}`, 'backend', 'id')
  declare updatePath: CapabilitiesPathProxy;
}
