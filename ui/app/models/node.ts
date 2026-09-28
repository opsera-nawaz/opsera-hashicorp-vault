/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model, { attr } from '@ember-data/model';

export default class NodeModel extends Model {
  @attr('string') declare name: string | undefined;
  // https://developer.hashicorp.com/vault/api-docs/system/health
  @attr('boolean') declare standby: boolean | undefined;
  get isActive(): boolean {
    return this.standby === false;
  }
  @attr('string') declare clusterId: string | undefined;

  get isLeader(): boolean {
    return Boolean(this.initialized && this.isActive);
  }

  // https://developer.hashicorp.com/vault/api-docs/system/seal-status
  @attr('boolean') declare initialized: boolean | undefined;
  @attr('boolean') declare sealed: boolean | undefined;
  get isSealed(): boolean | undefined {
    return this.sealed;
  }
  // The "t" parameter is the threshold, and "n" is the number of shares.
  @attr('number') declare t: number | undefined;
  @attr('number') declare n: number | undefined;
  @attr('number') declare progress: number | undefined;
  get sealThreshold(): number | undefined {
    return this.t;
  }
  get sealNumShares(): number | undefined {
    return this.n;
  }
  @attr('string') declare version: string | undefined;
  @attr('string') declare type: string | undefined;
  @attr('string') declare storageType: string | undefined;
  @attr('string') declare hcpLinkStatus: string | undefined;

  // https://developer.hashicorp.com/vault/api-docs/system/leader
  @attr('boolean') declare haEnabled: boolean | undefined;
  @attr('boolean') declare isSelf: boolean | undefined;
  @attr('string') declare leaderAddress: string | undefined;
}
