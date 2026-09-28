/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model, { attr } from '@ember-data/model';
import lazyCapabilities, { apiPath, type CapabilitiesPathProxy } from 'vault/macros/lazy-capabilities';
import { expandAttributeMeta } from 'vault/utils/field-to-attrs';

import type { FormField } from 'vault/app-types';

export default class TransformTemplate extends Model {
  idPrefix = 'template/';

  @attr('string', {
    readOnly: true,
    subText:
      'Templates allow Vault to determine what and how to capture the value to be transformed. This cannot be edited later.',
  })
  declare name: string | undefined;

  @attr('string', { defaultValue: 'regex' }) declare type: string;

  @attr('string', {
    editType: 'regex',
    subText: 'The template’s pattern defines the data format. Expressed in regex.',
  })
  declare pattern: string | undefined;

  @attr('array', {
    subText:
      'Alphabet defines a set of characters (UTF-8) that is used for FPE to determine the validity of plaintext and ciphertext values. You can choose a built-in one, or create your own.',
    editType: 'searchSelect',
    isSectionHeader: true,
    fallbackComponent: 'string-list',
    label: 'Alphabet',
    models: ['transform/alphabet'],
    selectLimit: 1,
  })
  declare alphabet: string[] | undefined;

  @attr('string') declare encodeFormat: string | undefined;
  @attr('') declare decodeFormats: string | undefined;

  @attr('string', { readOnly: true }) declare backend: string | undefined;

  get readAttrs(): FormField[] {
    const keys = ['name', 'pattern', 'encodeFormat', 'decodeFormats', 'alphabet'];
    return expandAttributeMeta(this, keys);
  }

  get writeAttrs(): FormField[] {
    return expandAttributeMeta(this, ['name', 'pattern', 'alphabet']);
  }

  @lazyCapabilities(apiPath`${'backend'}/template/${'id'}`, 'backend')
  declare updatePath: CapabilitiesPathProxy;
}
