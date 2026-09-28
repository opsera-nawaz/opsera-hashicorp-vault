/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model, { attr } from '@ember-data/model';
import { capitalize } from '@ember/string';
import { expandAttributeMeta } from 'vault/utils/field-to-attrs';
import { withModelValidations } from 'vault/decorators/model-validations';
import { isPresent } from '@ember/utils';

import type { FormField, Validations } from 'vault/app-types';

const METHOD_PROPS: Record<string, string[]> = {
  common: [],
  duo: ['username_format', 'secret_key', 'integration_key', 'api_hostname', 'push_info', 'use_passcode'],
  okta: ['username_format', 'mount_accessor', 'org_name', 'api_token', 'base_url', 'primary_email'],
  totp: [
    'issuer',
    'period',
    'key_size',
    'qr_size',
    'algorithm',
    'digits',
    'skew',
    'max_validation_attempts',
    'enable_self_enrollment',
  ],
  pingid: [
    'username_format',
    'settings_file_base64',
    'use_signature',
    'idp_url',
    'admin_url',
    'authenticator_url',
    'org_alias',
  ],
};

const REQUIRED_PROPS: Record<string, string[]> = {
  duo: ['secret_key', 'integration_key', 'api_hostname'],
  okta: ['org_name', 'api_token'],
  totp: ['issuer'],
  pingid: ['settings_file_base64'],
};

const validators: Validations = Object.keys(REQUIRED_PROPS).reduce((obj: Validations, type) => {
  REQUIRED_PROPS[type]!.forEach((prop) => {
    obj[prop] = [
      {
        message: `${prop.replace(/_/g, ' ')} is required`,
        validator(model: MfaMethod) {
          return model.type === type ? isPresent((model as unknown as Record<string, unknown>)[prop]) : true;
        },
      },
    ];
  });
  return obj;
}, {});

@withModelValidations(validators)
export default class MfaMethod extends Model {
  // common
  @attr('string') declare type: string | undefined;
  @attr('string', {
    label: 'Username format',
    subText: 'How to map identity names to MFA method names. ',
  })
  declare username_format: string | undefined;
  @attr('string', {
    label: 'Namespace',
  })
  declare namespace_path: string | undefined;
  @attr('string') declare mount_accessor: string | undefined;

  // PING ID
  @attr('string', {
    label: 'Settings file',
    subText: 'A base-64 encoded third party setting file retrieved from the PingIDs configuration page.',
  })
  declare settings_file_base64: string | undefined;
  @attr('boolean') declare use_signature: boolean | undefined;
  @attr('string') declare idp_url: string | undefined;
  @attr('string') declare admin_url: string | undefined;
  @attr('string') declare authenticator_url: string | undefined;
  @attr('string') declare org_alias: string | undefined;

  // OKTA
  @attr('string', {
    label: 'Organization name',
    subText: 'Name of the organization to be used in the Okta API.',
  })
  declare org_name: string | undefined;
  @attr('string', {
    label: 'Okta API key',
  })
  declare api_token: string | undefined;
  @attr('string', {
    label: 'Base URL',
    subText:
      'If set, will be used as the base domain for API requests. Example are okta.com, oktapreview.com and okta-emea.com.',
  })
  declare base_url: string | undefined;
  @attr('boolean') declare primary_email: boolean | undefined;

  // DUO
  @attr('string', {
    label: 'Duo secret key',
    sensitive: true,
  })
  declare secret_key: string | undefined;
  @attr('string', {
    label: 'Duo integration key',
    sensitive: true,
  })
  declare integration_key: string | undefined;
  @attr('string', {
    label: 'Duo API hostname',
  })
  declare api_hostname: string | undefined;
  @attr('string', {
    label: 'Duo push information',
    subText: 'Additional information displayed to the user when the push is presented to them.',
  })
  declare push_info: string | undefined;
  @attr('boolean', {
    label: 'Passcode reminder',
    subText: 'If this is turned on, the user is reminded to use the passcode upon MFA validation.',
  })
  declare use_passcode: boolean | undefined;

  // TOTP
  @attr('string', {
    label: 'Issuer',
    subText: 'The human-readable name of the keys issuing organization.',
  })
  declare issuer: string | undefined;
  @attr({
    label: 'Period',
    editType: 'ttl',
    helperTextEnabled: 'How long each generated TOTP is valid.',
    hideToggle: true,
    defaultValue: 30, // API accepts both an integer as seconds and sting with unit e.g 30 || '30s'
  })
  declare period: number | string;
  @attr('number', {
    label: 'Key size',
    subText: 'The size in bytes of the Vault generated key.',
    helperText: 'Byte size of the generated key.',
  })
  declare key_size: number | undefined;
  @attr('number', {
    label: 'QR size',
    subText: 'The pixel size of the generated square QR code.',
    helperText: 'Pixel size of the QR code.',
  })
  declare qr_size: number | undefined;
  @attr('string', {
    label: 'Algorithm',
    editType: 'radio',
    possibleValues: ['SHA1', 'SHA256', 'SHA512'],
    subText: 'The hashing algorithm used to generate the TOTP code.',
  })
  declare algorithm: string | undefined;
  @attr('number', {
    label: 'Digits',
    editType: 'radio',
    possibleValues: [6, 8],
    subText: 'The number digits in the generated TOTP code.',
    helperText: 'TOTP code length.',
  })
  declare digits: number | undefined;
  @attr('number', {
    label: 'Skew',
    editType: 'radio',
    possibleValues: [0, 1],
    subText: 'The number of delay periods allowed when validating a TOTP token.',
  })
  declare skew: number | undefined;
  @attr('number') declare max_validation_attempts: number | undefined;
  @attr('boolean', {
    label: 'Enable self-enrollment',
    editType: 'toggleButton',
    helperTextEnabled:
      'Let end users enroll in this MFA method on their own. You still control which auth mounts, groups, or entities it applies to.',
    helperTextDisabled:
      'Let end users enroll in this MFA method on their own. You still control which auth mounts, groups, or entities it applies to.',
  })
  declare enable_self_enrollment: boolean | undefined;

  get name(): string {
    const type = this.type ?? '';
    return type === 'totp' ? type.toUpperCase() : capitalize(type);
  }

  get icon(): string {
    switch (this.type) {
      case 'totp':
        return 'history';
      case 'pingid':
        return 'ping-identity-color';
      case 'duo':
        return 'duo-color';
      default:
        return this.type ?? '';
    }
  }

  get formFields(): string[] {
    return [...METHOD_PROPS['common']!, ...(METHOD_PROPS[this.type ?? ''] ?? [])];
  }

  get attrs(): FormField[] {
    return expandAttributeMeta(this, this.formFields);
  }
}
