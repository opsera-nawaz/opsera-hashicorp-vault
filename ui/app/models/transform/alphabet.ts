/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model, { attr } from '@ember-data/model';
import lazyCapabilities, { apiPath, type CapabilitiesPathProxy } from 'vault/macros/lazy-capabilities';
import { expandAttributeMeta } from 'vault/utils/field-to-attrs';

import type { FormField } from 'vault/app-types';

export default class Alphabet extends Model {
  idPrefix = 'alphabet/';

  @attr('string', {
    readOnly: true,
    subText: 'The alphabet name. Keep in mind that spaces are not allowed and this cannot be edited later.',
  })
  declare name: string | undefined;

  @attr('string', {
    label: 'Alphabet',
    subText:
      'Provide the set of valid UTF-8 characters contained within both the input and transformed value.',
    docLink: '/vault/api-docs/secret/transform#create-update-alphabet',
  })
  declare alphabet: string | undefined;

  get attrs(): FormField[] {
    const keys = ['name', 'alphabet'];
    return expandAttributeMeta(this, keys);
  }

  @attr('string', {
    readOnly: true,
  })
  declare backend: string | undefined;

  @lazyCapabilities(apiPath`${'backend'}/alphabet/${'id'}`, 'backend', 'id')
  declare updatePath: CapabilitiesPathProxy;
}
