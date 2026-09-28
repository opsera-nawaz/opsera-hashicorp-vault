/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model, { attr } from '@ember-data/model';
import lazyCapabilities, { apiPath, type CapabilitiesPathProxy } from 'vault/macros/lazy-capabilities';
import { expandAttributeMeta } from 'vault/utils/field-to-attrs';

const CREDENTIAL_TYPES = [
  {
    value: 'iam_user',
    displayName: 'IAM User',
  },
  {
    value: 'assumed_role',
    displayName: 'Assumed Role',
  },
  {
    value: 'federation_token',
    displayName: 'Federation Token',
  },
  {
    value: 'session_token',
    displayName: 'Session Token',
  },
];

const KEYS_FOR_CREDENTIAL_TYPE: Record<string, string[]> = {
  iam_user: ['name', 'credentialType', 'policyArns', 'policyDocument'],
  assumed_role: ['name', 'credentialType', 'roleArns', 'policyDocument'],
  federation_token: ['name', 'credentialType', 'policyDocument'],
  session_token: ['name', 'credentialType'],
};

export default class RoleAwsModel extends Model {
  @attr('string', {
    readOnly: true,
  })
  declare backend: string;

  @attr('string', {
    label: 'Role name',
    readOnly: true,
  })
  declare name: string;

  // credentialTypes are for backwards compatibility.
  // we use this to populate "credentialType" in
  // the serializer. if there is more than one, the
  // show and edit pages will show a warning
  @attr('array', {
    readOnly: true,
  })
  declare credentialTypes: string[] | undefined;

  @attr('string', {
    defaultValue: 'iam_user',
    possibleValues: CREDENTIAL_TYPES,
  })
  declare credentialType: string;

  @attr({
    editType: 'stringArray',
    label: 'Role ARNs',
  })
  declare roleArns: string[] | undefined;

  @attr({
    editType: 'stringArray',
    label: 'Policy ARNs',
  })
  declare policyArns: string[] | undefined;

  @attr('string', {
    editType: 'json',
    helpText:
      'A policy is an object in AWS that, when associated with an identity or resource, defines their permissions.',
    // Cannot have a default_value on policy_document because in some cases AWS expects this value to be empty.
  })
  declare policyDocument: string | undefined;

  get fields() {
    const keys = KEYS_FOR_CREDENTIAL_TYPE[this.credentialType] ?? [];
    return expandAttributeMeta(this, keys);
  }

  @lazyCapabilities(apiPath`${'backend'}/roles/${'id'}`, 'backend', 'id')
  declare updatePath: CapabilitiesPathProxy;
  get canDelete(): boolean {
    return this.updatePath.get('canDelete') ?? false;
  }
  get canEdit(): boolean {
    return this.updatePath.get('canUpdate') ?? false;
  }
  get canRead(): boolean {
    return this.updatePath.get('canRead') ?? false;
  }

  @lazyCapabilities(apiPath`${'backend'}/creds/${'id'}`, 'backend', 'id')
  declare generatePath: CapabilitiesPathProxy;
  get canGenerate(): boolean {
    return this.generatePath.get('canUpdate') ?? false;
  }
}
