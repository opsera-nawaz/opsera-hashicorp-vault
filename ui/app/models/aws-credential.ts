/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model, { attr } from '@ember-data/model';
import { withExpandedAttributes } from 'vault/decorators/model-expanded-attributes';

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

@withExpandedAttributes()
export default class AwsCredential extends Model {
  @attr('object', {
    readOnly: true,
  })
  declare role: Record<string, unknown> | undefined;

  @attr('string', {
    defaultValue: 'iam_user',
    possibleValues: CREDENTIAL_TYPES,
    readOnly: true,
  })
  declare credentialType: string;

  @attr('string', {
    label: 'Role ARN',
    helpText:
      'The ARN of the role to assume if credential_type on the Vault role is assumed_role. Optional if the role has a single role ARN; required otherwise.',
  })
  declare roleArn: string | undefined;

  @attr({
    editType: 'ttl',
    defaultValue: '3600s',
    setDefault: true,
    ttlOffValue: '',
    label: 'TTL',
    helpText:
      'Specifies the TTL for the use of the STS token. Valid only when credential_type is assumed_role, federation_token, or session_token.',
  })
  declare ttl: string | undefined;

  @attr('string') declare leaseId: string | undefined;
  @attr('boolean') declare renewable: boolean | undefined;
  @attr('number') declare leaseDuration: number | undefined;
  @attr('string') declare accessKey: string | undefined;
  @attr('string', { masked: true }) declare secretKey: string | undefined;
  @attr('string', { masked: true }) declare securityToken: string | undefined;

  get toCreds(): string {
    const props: Record<string, string | undefined> = {
      accessKey: this.accessKey,
      secretKey: this.secretKey,
      securityToken: this.securityToken,
      leaseId: this.leaseId,
    };
    const propsWithVals = Object.keys(props).reduce((ret: Record<string, string>, prop) => {
      const value = props[prop];
      if (value) {
        ret[prop] = value;
        return ret;
      }
      return ret;
    }, {});
    return JSON.stringify(propsWithVals, null, 2);
  }
}
