/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */
import Model, { attr } from '@ember-data/model';
import { service } from '@ember/service';
import lazyCapabilities, { apiPath, type CapabilitiesPathProxy } from 'vault/macros/lazy-capabilities';
import { getRoleFields } from 'vault/utils/model-helpers/database-helpers';
import { expandAttributeMeta } from 'vault/utils/field-to-attrs';
import { withModelValidations } from 'vault/decorators/model-validations';

import type Service from '@ember/service';
import type { FormField, Validations } from 'vault/app-types';

const validations: Validations = {
  name: [{ type: 'presence', message: 'Role name is required.' }],
  database: [{ type: 'presence', message: 'Database is required.' }],
  type: [{ type: 'presence', message: 'Type is required.' }],
  username: [
    {
      validator(model: RoleModel) {
        const { type, username } = model;
        if (!type || type === 'dynamic') return true;
        if (username) return true;
        return false;
      },
      message: 'Username is required.',
    },
  ],
};
@withModelValidations(validations)
export default class RoleModel extends Model {
  @service declare version: Service & { isEnterprise?: boolean };

  idPrefix = 'role/';

  @attr('string', { readOnly: true }) declare backend: string | undefined;

  @attr('string', { label: 'Role name' }) declare name: string | undefined;

  @attr('array', {
    label: 'Connection name',
    editType: 'searchSelect',
    fallbackComponent: 'string-list',
    models: ['database/connection'],
    selectLimit: 1,
    onlyAllowExisting: true,
    subText: 'The database connection for which credentials will be generated.',
  })
  declare database: string[];

  @attr('string', {
    label: 'Type of role',
    noDefault: true,
    possibleValues: ['static', 'dynamic'],
  })
  declare type: string | undefined;

  @attr({
    editType: 'ttl',
    defaultValue: '1h',
    label: 'Generated credentials’s Time-to-Live (TTL)',
    helperTextDisabled: 'Vault will use a TTL of 1 hour.',
    defaultShown: 'Engine default',
  })
  declare default_ttl: string;

  @attr({
    editType: 'ttl',
    defaultValue: '24h',
    label: 'Generated credentials’s maximum Time-to-Live (Max TTL)',
    helperTextDisabled: 'Vault will use a TTL of 24 hours.',
    defaultShown: 'Engine default',
  })
  declare max_ttl: string;

  @attr('string', { subText: 'The database username that this Vault role corresponds to.' })
  declare username: string | undefined;

  @attr({
    editType: 'ttl',
    defaultValue: '24h',
    helperTextDisabled:
      'Specifies the amount of time Vault should wait before rotating the password. The minimum is 5 seconds. Default is 24 hours.',
    helperTextEnabled: 'Vault will rotate password after.',
  })
  declare rotation_period: string;

  @attr('array', {
    editType: 'stringArray',
  })
  declare creation_statements: string[] | undefined;

  @attr('array', {
    editType: 'stringArray',
    defaultShown: 'Default',
  })
  declare revocation_statements: string[] | undefined;

  @attr('array', {
    editType: 'stringArray',
    defaultShown: 'Default',
  })
  declare rotation_statements: string[] | undefined;

  @attr('array', {
    editType: 'stringArray',
    defaultShown: 'Default',
  })
  declare rollback_statements: string[] | undefined;

  @attr('array', {
    editType: 'stringArray',
    defaultShown: 'Default',
  })
  declare renew_statements: string[] | undefined;

  @attr('string', {
    editType: 'json',
    allowReset: true,
    theme: 'hashi short',
    defaultShown: 'Default',
  })
  declare creation_statement: string | undefined;

  @attr('string', {
    editType: 'json',
    allowReset: true,
    theme: 'hashi short',
    defaultShown: 'Default',
  })
  declare revocation_statement: string | undefined;

  @attr('string', { readOnly: true }) declare last_vault_rotation: string | undefined;

  // ENTERPRISE ONLY
  @attr({
    label: 'Rotate immediately',
    editType: 'toggleButton',
    helperTextEnabled: 'Vault will rotate the password for this static role on creation.',
    helperTextDisabled: "Vault will not rotate this role's password on creation.",
    isOppositeValue: true,
  })
  declare skip_import_rotation: boolean | undefined;

  @attr('string', {
    sensitive: true,
    subText: 'The database password that this Vault role corresponds to.',
  })
  declare password: string | undefined;

  /* FIELD ATTRIBUTES */
  get fieldAttrs(): FormField[] {
    // Main fields on edit/create form
    const fields = ['name', 'database', 'type'];
    return expandAttributeMeta(this, fields);
  }
  get showFields(): FormField[] {
    let fields = ['name', 'database', 'type'];
    fields = fields.concat(getRoleFields(this.type)).concat(['creation_statements']);
    // elasticsearch does not support revocation statements: https://developer.hashicorp.com/vault/api-docs/secret/databases/elasticdb#parameters-1
    if (this.database[0] !== 'elasticsearch') {
      fields = fields.concat(['revocation_statements']);
    }
    return expandAttributeMeta(this, fields);
  }
  get roleSettingAttrs(): FormField[] {
    // logic for which get displayed is on DatabaseRoleSettingForm
    let allRoleSettingFields = [
      'default_ttl',
      'max_ttl',
      'username',
      'password',
      'rotation_period',
      'skip_import_rotation',
      'creation_statements',
      'creation_statement', // for editType: JSON
      'revocation_statements',
      'revocation_statement', // only for MongoDB (editType: JSON)
      'rotation_statements',
      'rollback_statements',
      'renew_statements',
    ];

    // remove enterprise-only attrs if on community
    if (!this.version.isEnterprise) {
      allRoleSettingFields = allRoleSettingFields.filter(
        (role) => !['skip_import_rotation', 'password'].includes(role)
      );
    }

    return expandAttributeMeta(this, allRoleSettingFields);
  }
  /* CAPABILITIES */
  // only used for secretPath
  @attr('string', { readOnly: true }) declare path: string | undefined;
  @lazyCapabilities(apiPath`${'backend'}/${'path'}/${'id'}`, 'backend', 'path', 'id')
  declare secretPath: CapabilitiesPathProxy;
  @lazyCapabilities(apiPath`${'backend'}/roles/+`, 'backend') declare dynamicPath: CapabilitiesPathProxy;
  @lazyCapabilities(apiPath`${'backend'}/static-roles/+`, 'backend')
  declare staticPath: CapabilitiesPathProxy;
  @lazyCapabilities(apiPath`${'backend'}/creds/${'id'}`, 'backend', 'id')
  declare credentialPath: CapabilitiesPathProxy;
  @lazyCapabilities(apiPath`${'backend'}/static-creds/${'id'}`, 'backend', 'id')
  declare staticCredentialPath: CapabilitiesPathProxy;
  @lazyCapabilities(apiPath`${'backend'}/config/${'database[0]'}`, 'backend', 'database')
  declare databasePath: CapabilitiesPathProxy;
  @lazyCapabilities(apiPath`${'backend'}/rotate-role/${'id'}`, 'backend', 'id')
  declare rotateRolePath: CapabilitiesPathProxy;

  get canEditRole(): boolean {
    return this.secretPath.get('canUpdate') ?? false;
  }
  get canDelete(): boolean {
    return this.secretPath.get('canDelete') ?? false;
  }
  get canCreateDynamic(): boolean {
    return this.dynamicPath.get('canCreate') ?? false;
  }
  get canCreateStatic(): boolean {
    return this.staticPath.get('canCreate') ?? false;
  }
  get canGenerateCredentials(): boolean {
    return this.credentialPath.get('canRead') ?? false;
  }
  get canGetCredentials(): boolean {
    return this.staticCredentialPath.get('canRead') ?? false;
  }
  get canUpdateDb(): boolean {
    return this.databasePath.get('canUpdate') ?? false;
  }
  get canRotateRoleCredentials(): boolean {
    return this.rotateRolePath.get('canUpdate') ?? false;
  }
}
