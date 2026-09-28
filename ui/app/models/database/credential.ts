/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model, { attr } from '@ember-data/model';

export default class DatabaseCredentialModel extends Model {
  @attr('string') declare username: string | undefined;
  @attr('string') declare password: string | undefined;
  @attr('string') declare rsaPrivateKey: string | undefined;
  @attr('string') declare leaseId: string | undefined;
  @attr('string') declare leaseDuration: string | undefined;
  @attr('string') declare lastVaultRotation: string | undefined;
  @attr('number') declare rotationPeriod: number | undefined;
  @attr('number') declare ttl: number | undefined;
  @attr('string') declare roleType: string | undefined;
}
