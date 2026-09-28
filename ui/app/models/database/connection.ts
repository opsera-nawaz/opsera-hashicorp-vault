/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model, { attr } from '@ember-data/model';
import lazyCapabilities, { apiPath, type CapabilitiesPathProxy } from 'vault/macros/lazy-capabilities';
import fieldToAttrs, { expandAttributeMeta } from 'vault/utils/field-to-attrs';
import { AVAILABLE_PLUGIN_TYPES } from '../../utils/model-helpers/database-helpers';
import { service } from '@ember/service';

import type Service from '@ember/service';
import type { FormField, FormFieldGroups } from 'vault/app-types';

interface DatabasePluginField {
  attr: string;
  show?: boolean;
  group?: string;
  subgroup?: string;
  isEnterprise?: boolean;
}

interface DatabasePluginType {
  value: string;
  displayName?: string;
  fields: DatabasePluginField[];
}

const PLUGIN_TYPES = AVAILABLE_PLUGIN_TYPES as DatabasePluginType[];

/**
 * fieldsToGroups helper fn
 * @param arr any subset of "fields" from AVAILABLE_PLUGIN_TYPES
 * @param key item by which to group the fields. If item has no group it will be under "default"
 * @returns array of objects where the key is default or the name of the option group, and the value is an array of attr names
 */
const fieldsToGroups = function (arr: DatabasePluginField[], key: 'subgroup' | 'group' = 'subgroup') {
  const fieldGroups: Record<string, string[]>[] = [];
  const byGroup = arr.reduce(function (rv: Record<string, DatabasePluginField[]>, x) {
    const groupKey = String(x[key]);
    (rv[groupKey] = rv[groupKey] || []).push(x);
    return rv;
  }, {});
  Object.keys(byGroup).forEach((groupKey) => {
    const attrsArray = byGroup[groupKey]!.map((obj) => obj.attr);
    const group = groupKey === 'undefined' ? 'default' : groupKey;
    fieldGroups.push({ [group]: attrsArray });
  });
  return fieldGroups;
};

export default class DatabaseConnectionModel extends Model {
  @service declare version: Service & { isEnterprise?: boolean };

  @attr('string', {
    readOnly: true,
  })
  declare backend: string | undefined;
  // required
  @attr('string', {
    label: 'Connection name',
  })
  declare name: string | undefined;
  @attr('string', {
    label: 'Database plugin',
    possibleValues: AVAILABLE_PLUGIN_TYPES,
    noDefault: true,
  })
  declare plugin_name: string | undefined;

  // standard
  @attr('boolean', {
    label: 'Connection will be verified',
    defaultValue: true,
  })
  declare verify_connection: boolean;
  @attr('array') declare allowed_roles: string[] | undefined;
  @attr('string', {
    label: 'Use custom password policy',
    editType: 'optionalText',
    subText: 'Specify the name of an existing password policy.',
    defaultSubText:
      'Unless a custom policy is specified, Vault will use a default: 20 characters with at least 1 uppercase, 1 lowercase, 1 number, and 1 dash character.',
    defaultShown: 'Default',
    docLink: '/vault/docs/concepts/password-policies',
  })
  declare password_policy: string | undefined;

  // common fields
  @attr('string', {
    label: 'Connection URL',
    subText:
      'The connection string used to connect to the database. This allows for simple templating of username and password of the root user in the {{field_name}} format.',
  })
  declare connection_url: string | undefined;
  @attr('string', {
    label: 'URL',
    subText: `The URL for Elasticsearch's API ("https://localhost:9200").`,
  })
  declare url: string | undefined;
  @attr('string', {
    subText: `The name of the user to use as the "root" user when connecting to the database.`,
  })
  declare username: string | undefined;
  @attr('string', {
    subText: 'The password to use when connecting with the above username.',
    editType: 'password',
  })
  declare password: string | undefined;
  @attr('boolean', {
    defaultValue: false,
    subText: 'Turns off the escaping of special characters inside of the username and password fields.',
    docLink: '/vault/docs/secrets/databases#disable-character-escaping',
  })
  declare disable_escaping: boolean;

  // optional
  @attr('string', {
    label: 'CA certificate',
    subText: `The path to a PEM-encoded CA cert file to use to verify the Elasticsearch server's identity.`,
  })
  declare ca_cert: string | undefined;
  @attr('string', {
    label: 'CA path',
    subText: `The path to a directory of PEM-encoded CA cert files to use to verify the Elasticsearch server's identity.`,
  })
  declare ca_path: string | undefined;
  @attr('string', {
    label: 'Client certificate',
    subText: 'The path to the certificate for the Elasticsearch client to present for communication.',
  })
  declare client_cert: string | undefined;
  @attr('string', {
    subText: 'The path to the key for the Elasticsearch client to use for communication.',
  })
  declare client_key: string | undefined;
  @attr('string', {}) declare hosts: string | undefined;
  @attr('string', {}) declare host: string | undefined;
  @attr('string', {}) declare port: string | undefined;
  @attr('string', {
    subText: 'Optional. Must be in JSON. See our documentation for help.',
    allowReset: true,
    editType: 'json',
    theme: 'hashi short',
    defaultShown: 'Default',
  })
  declare write_concern: string | undefined;
  @attr('string', {
    editType: 'optionalText',
    subText: 'Enter the custom username template to use.',
    defaultSubText:
      'Template describing how dynamic usernames are generated. Vault will use the default for this plugin.',
    docLink: '/vault/docs/concepts/username-templating',
    defaultShown: 'Default',
  })
  declare username_template: string | undefined;
  @attr('number', {
    defaultValue: 4,
  })
  declare max_open_connections: number;
  @attr('number', {
    defaultValue: 0,
  })
  declare max_idle_connections: number;
  @attr('string', {
    defaultValue: '0s',
  })
  declare max_connection_lifetime: string;
  @attr('boolean', {
    label: 'Disable SSL verification',
    defaultValue: false,
  })
  declare insecure: boolean;
  @attr('string', {
    defaultValue: 'password',
    editType: 'radio',
    subText: 'The default is "password."',
    possibleValues: [
      {
        value: 'password',
        helpText:
          'Passwords will be sent to PostgreSQL in plaintext format and may appear in PostgreSQL logs as-is.',
      },
      {
        value: 'scram-sha-256',
        helpText:
          'When set to "scram-sha-256", passwords will be hashed by Vault and stored as-is by PostgreSQL. Using "scram-sha-256" requires a minimum version of PostgreSQL 10.',
      },
    ],
    docLink: '/vault/api-docs/secret/databases/postgresql#password_authentication',
  })
  declare password_authentication: string;
  @attr('string', {
    subText: 'If set to "gcp_iam", will enable IAM authentication to a Google CloudSQL instance.',
    docLink: '/vault/api-docs/secret/databases/postgresql#auth_type',
  })
  declare auth_type: string | undefined;
  @attr('string', {
    label: 'Service account JSON',
    subText:
      'JSON encoded credentials for a GCP Service Account to use for IAM authentication. Requires "auth_type" to be "gcp_iam".',
    editType: 'file',
  })
  declare service_account_json: string | undefined;
  @attr('boolean', {
    label: 'Use private IP',
    subText:
      'Enables the option to connect to CloudSQL Instances with Private IP. Requires auth_type to be "gcp_iam".',
    defaultValue: false,
  })
  declare use_private_ip: boolean;
  @attr('string', {
    helpText: 'The secret key used for the x509 client certificate. Must be PEM encoded.',
    editType: 'file',
  })
  declare private_key: string | undefined;
  @attr('string', {
    label: 'TLS Certificate Key',
    helpText:
      'x509 certificate for connecting to the database. This must be a PEM encoded version of the private key and the certificate combined.',
    editType: 'file',
  })
  declare tls: string | undefined;
  @attr('string', {
    label: 'TLS Certificate Key',
    helpText: 'The x509 certificate for connecting to the database. Must be PEM encoded.',
    editType: 'file',
  })
  declare tls_certificate: string | undefined;
  @attr('string', {
    label: 'TLS CA',
    helpText:
      'x509 CA file for validating the certificate presented by the database server. Must be PEM encoded.',
    editType: 'file',
  })
  declare tls_ca: string | undefined;
  @attr('string', {
    label: 'TLS server name',
    subText: 'If set, this name is used to set the SNI host when connecting via 1TLS.',
  })
  declare tls_server_name: string | undefined;
  @attr({
    subText: `The database statements to be executed to rotate the root user's credentials. If nothing is entered, Vault will use a reasonable default.`,
    editType: 'stringArray',
    defaultShown: 'Default',
  })
  declare root_rotation_statements: string[] | undefined;

  // ENTERPRISE ONLY
  @attr({
    editType: 'toggleButton',
    label: 'Rotate static roles immediately',
    helperTextEnabled: 'Vault automatically rotates static roles upon their initial creation.',
    helperTextDisabled: 'Vault will not automatically rotate static role passwords upon creation.',
    defaultValue: false,
    isOppositeValue: true,
  })
  declare skip_static_role_rotation_import: boolean | undefined;

  @attr('boolean', {
    subText:
      'Allows onboarding static roles with a rootless connection configuration. Mutually exclusive with username and password. If true, will force verify_connection to be false.',
    defaultValue: false,
  })
  declare self_managed: boolean;

  get isAvailablePlugin(): boolean {
    return !!PLUGIN_TYPES.find((a) => a.value === this.plugin_name);
  }

  get showAttrs(): FormField[] {
    const fields = this._filterFields((f) => f.show !== false).map((f) => f.attr);
    fields.push('allowed_roles');
    return expandAttributeMeta(this, fields);
  }

  // for both create and edit fields
  get fieldAttrs(): FormField[] {
    let fields = ['plugin_name', 'name', 'connection_url', 'verify_connection', 'password_policy'];
    if (this.plugin_name) {
      fields = this._filterFields((f) => !f.group).map((f) => f.attr);
    }
    return expandAttributeMeta(this, fields);
  }

  get pluginFieldGroups(): Array<FormFieldGroups> | null {
    if (!this.plugin_name) {
      return null;
    }
    const pluginFields = this._filterFields((f) => f.group === 'pluginConfig');
    const groups = fieldsToGroups(pluginFields, 'subgroup');
    return fieldToAttrs(this, groups);
  }

  get statementFields(): FormField[] {
    if (!this.plugin_name) {
      return expandAttributeMeta(this, ['root_rotation_statements']);
    }
    const fields = this._filterFields((f) => f.group === 'statements').map((f) => f.attr);
    return expandAttributeMeta(this, fields);
  }

  // after checking for enterprise, filter callback fires and returns
  _filterFields(filterCallback: (field: DatabasePluginField) => boolean | undefined): DatabasePluginField[] {
    const plugin = PLUGIN_TYPES.find((a) => a.value === this.plugin_name);
    return (plugin?.fields ?? []).filter((field) => {
      // return if attribute is enterprise only and we're on community
      if (field?.isEnterprise && !this.version.isEnterprise) return false;
      // filter by group, or if there isn't a group
      return filterCallback(field);
    });
  }

  /* CAPABILITIES */
  @lazyCapabilities(apiPath`${'backend'}/config/${'id'}`, 'backend', 'id')
  declare editConnectionPath: CapabilitiesPathProxy;
  get canEdit(): boolean {
    return this.editConnectionPath.get('canUpdate') ?? false;
  }
  get canDelete(): boolean {
    return this.editConnectionPath.get('canDelete') ?? false;
  }
  @lazyCapabilities(apiPath`${'backend'}/reset/${'id'}`, 'backend', 'id')
  declare resetConnectionPath: CapabilitiesPathProxy;
  get canReset(): boolean {
    return (this.resetConnectionPath.get('canUpdate') || this.resetConnectionPath.get('canCreate')) ?? false;
  }
  @lazyCapabilities(apiPath`${'backend'}/rotate-root/${'id'}`, 'backend', 'id')
  declare rotateRootPath: CapabilitiesPathProxy;
  get canRotateRoot(): boolean {
    return (this.rotateRootPath.get('canUpdate') || this.rotateRootPath.get('canCreate')) ?? false;
  }
  @lazyCapabilities(apiPath`${'backend'}/role/*`, 'backend') declare rolePath: CapabilitiesPathProxy;
  @lazyCapabilities(apiPath`${'backend'}/static-role/*`, 'backend')
  declare staticRolePath: CapabilitiesPathProxy;
  get canAddRole(): boolean {
    return (this.rolePath.get('canCreate') || this.staticRolePath.get('canCreate')) ?? false;
  }
}
