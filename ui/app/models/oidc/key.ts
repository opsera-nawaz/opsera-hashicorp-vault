/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model, { attr } from '@ember-data/model';
import lazyCapabilities, { apiPath, type CapabilitiesPathProxy } from 'vault/macros/lazy-capabilities';
import { expandAttributeMeta } from 'vault/utils/field-to-attrs';
import { withModelValidations } from 'vault/decorators/model-validations';

import type { FormField, Validations } from 'vault/app-types';

const validations: Validations = {
  name: [
    { type: 'presence', message: 'Name is required.' },
    {
      type: 'containsWhiteSpace',
      message: 'Name cannot contain whitespace.',
    },
  ],
};

@withModelValidations(validations)
export default class OidcKeyModel extends Model {
  @attr('string', { editDisabled: true }) declare name: string | undefined;
  @attr('string', {
    defaultValue: 'RS256',
    possibleValues: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512', 'EdDSA'],
  })
  declare algorithm: string;

  @attr({ editType: 'ttl', defaultValue: '24h' }) declare rotationPeriod: string;
  @attr({ label: 'Verification TTL', editType: 'ttl', defaultValue: '24h' }) declare verificationTtl: string;
  @attr('array', { label: 'Allowed applications' }) declare allowedClientIds: string[] | undefined; // no editType because does not use form-field component

  // TODO refactor when field-to-attrs is refactored as decorator
  _attributeMeta: FormField[] | null = null; // cache initial result of expandAttributeMeta in getter and return
  get formFields(): FormField[] {
    if (!this._attributeMeta) {
      this._attributeMeta = expandAttributeMeta(this, [
        'name',
        'algorithm',
        'rotationPeriod',
        'verificationTtl',
      ]);
    }
    return this._attributeMeta;
  }

  @lazyCapabilities(apiPath`identity/oidc/key/${'name'}`, 'name') declare keyPath: CapabilitiesPathProxy;
  @lazyCapabilities(apiPath`identity/oidc/key/${'name'}/rotate`, 'name')
  declare rotatePath: CapabilitiesPathProxy;
  get canRead(): boolean {
    return this.keyPath.get('canRead') ?? false;
  }
  get canEdit(): boolean {
    return this.keyPath.get('canUpdate') ?? false;
  }
  get canRotate(): boolean {
    return this.rotatePath.get('canUpdate') ?? false;
  }
  get canDelete(): boolean {
    return this.keyPath.get('canDelete') ?? false;
  }
}
