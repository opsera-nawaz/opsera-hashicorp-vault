/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { service } from '@ember/service';
import { or } from '@ember/object/computed';
import { isPresent } from '@ember/utils';
import Mixin from '@ember/object/mixin';
import { task } from 'ember-concurrency';

import type ApiService from 'vault/services/api';
import type { ApiParsedError, ApiErrorResponse } from 'vault/api';

interface ReplicationActionData {
  replicationMode?: string;
  [key: string]: unknown;
}

interface ReplicationClusterLike {
  reload(): Promise<unknown>;
  rollbackAttributes(): void;
}

// See list-controller.ts's ListControllerMixinThis comment: Mixin.create()'s
// own typing doesn't propagate a usable `this` type into the object
// literal's methods, so the shape this mixin needs from its host component
// is supplied explicitly per-method via TypeScript's `this` parameter. The
// individual `systemWriteReplication*` calls below accept endpoint-specific
// request types from @hashicorp/vault-client-typescript that this loosely
// shaped, dynamically-built `data` object doesn't model 1:1, so those call
// sites use `as never` rather than fabricating a falsely-precise cast.
interface ReplicationActionsMixinThis {
  api: ApiService;
  replicationMode?: string;
  cluster?: ReplicationClusterLike;
  reset?: () => void;
  set(key: string, value: unknown): void;
  setProperties(hash: Record<string, unknown>): void;
  save: { perform: (...args: unknown[]) => unknown };
  submitSuccess: { perform: (...args: unknown[]) => unknown };
  onDisable(): unknown;
  onPromote(): unknown;
  replicationAction(
    action: string,
    replicationMode: string,
    clusterMode: string,
    data?: ReplicationActionData
  ): unknown;
  submitError(e: ApiErrorResponse | undefined): unknown;
}

export default Mixin.create({
  api: service(),

  loading: or('save.isRunning', 'submitSuccess.isRunning'),

  onDisable() {},
  onPromote() {},

  replicationAction(
    this: ReplicationActionsMixinThis,
    action: string,
    replicationMode: string,
    clusterMode: string,
    data: ReplicationActionData = {}
  ) {
    switch (action) {
      case 'disable':
        if (replicationMode === 'dr' && clusterMode === 'primary') {
          return this.api.sys.systemWriteReplicationDrPrimaryDisable();
        }
        if (replicationMode === 'dr' && clusterMode === 'secondary') {
          return this.api.sys.systemWriteReplicationDrSecondaryDisable(data as never);
        }
        if (replicationMode === 'performance' && clusterMode === 'primary') {
          return this.api.sys.systemWriteReplicationPerformancePrimaryDisable();
        }
        if (replicationMode === 'performance' && clusterMode === 'secondary') {
          return this.api.sys.systemWriteReplicationPerformanceSecondaryDisable();
        }
        break;
      case 'demote':
        if (replicationMode === 'dr' && clusterMode === 'primary') {
          return this.api.sys.systemWriteReplicationDrPrimaryDemote();
        }
        if (replicationMode === 'performance' && clusterMode === 'primary') {
          return this.api.sys.systemWriteReplicationPerformancePrimaryDemote();
        }
        break;
      case 'promote':
        if (replicationMode === 'dr' && clusterMode === 'secondary') {
          return this.api.sys.systemWriteReplicationDrSecondaryPromote(data as never);
        }
        if (replicationMode === 'performance' && clusterMode === 'secondary') {
          return this.api.sys.systemWriteReplicationPerformanceSecondaryPromote(data as never);
        }
        break;
      case 'update-primary':
        if (replicationMode === 'dr' && clusterMode === 'secondary') {
          return this.api.sys.systemWriteReplicationDrSecondaryUpdatePrimary(data as never);
        }
        if (replicationMode === 'performance' && clusterMode === 'secondary') {
          return this.api.sys.systemWriteReplicationPerformanceSecondaryUpdatePrimary(data as never);
        }
        break;
      case 'recover':
        return this.api.sys.systemWriteReplicationRecover();
      case 'reindex':
        return this.api.sys.systemWriteReplicationReindex(data as never);
    }

    throw new Error(`Unsupported replication action: ${replicationMode}/${clusterMode}/${action}`);
  },

  submitHandler: task(function* (
    this: ReplicationActionsMixinThis,
    action: string,
    clusterMode: string,
    data: ReplicationActionData,
    event?: Event
  ): Generator<unknown, unknown, unknown> {
    const replicationMode = (data && data.replicationMode) || this.replicationMode;
    if (event && event.preventDefault) {
      event.preventDefault();
    }
    this.setProperties({
      errors: [],
    });
    if (data) {
      data = Object.keys(data).reduce((newData: ReplicationActionData, key) => {
        const val = data[key];
        if (isPresent(val)) {
          if (key === 'dr_operation_token_primary' || key === 'dr_operation_token_promote') {
            newData['dr_operation_token'] = val;
          } else {
            newData[key] = val;
          }
        }
        return newData;
      }, {});
      delete data.replicationMode;
    }
    return yield this.save.perform(action, replicationMode, clusterMode, data);
  }),

  save: task(function* (
    this: ReplicationActionsMixinThis,
    action: string,
    replicationMode: string,
    clusterMode: string,
    data: ReplicationActionData
  ): Generator<unknown, unknown, unknown> {
    try {
      const response = yield this.replicationAction(action, replicationMode, clusterMode, data);
      return yield this.submitSuccess.perform(response, action, clusterMode);
    } catch (e) {
      const { response } = (yield this.api.parseError(e)) as ApiParsedError;
      return this.submitError(response);
    }
  }).drop(),

  submitSuccess: task(function* (
    this: ReplicationActionsMixinThis,
    resp: { wrap_info?: { token?: string } } | undefined,
    action: string
  ): Generator<unknown, ReplicationClusterLike | undefined, unknown> {
    // enable action is handled separately in EnableReplicationForm component
    const cluster = this.cluster;
    if (!cluster) {
      return undefined;
    }

    if (resp && resp.wrap_info) {
      this.set('token', resp.wrap_info.token);
    }
    if (action === 'secondary-token') {
      this.setProperties({
        loading: false,
        primary_api_addr: null,
        primary_cluster_addr: null,
      });
      return cluster;
    }
    if (this.reset) {
      this.reset();
    }
    try {
      yield cluster.reload();
    } catch {
      // no error handling here
    }
    cluster.rollbackAttributes();
    if (action === 'disable') {
      yield this.onDisable();
    }
    if (action === 'promote') {
      yield this.onPromote();
    }
    return undefined;
  }).drop(),

  submitError(this: ReplicationActionsMixinThis, e: ApiErrorResponse | undefined) {
    if (e?.errors) {
      this.set('errors', e.errors);
    } else {
      throw e;
    }
  },
});
