/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model, { attr } from '@ember-data/model';

interface MerkleSyncProgress {
  sync_total_keys?: number;
  sync_progress?: number;
}

export default class ReplicationAttributesModel extends Model {
  @attr('string') declare clusterId: string | undefined;
  get clusterIdDisplay(): string | null {
    const clusterId = this.clusterId;
    return clusterId ? clusterId.split('-')[0]! : null;
  }

  @attr('string') declare mode: string | undefined;
  get replicationDisabled(): boolean {
    return /disabled|unsupported/.test(this.mode ?? '');
  }
  get replicationUnsupported(): boolean {
    return /unsupported/.test(this.mode ?? '');
  }
  get replicationEnabled(): boolean {
    return !this.replicationDisabled;
  }

  // primary attrs
  get isPrimary(): boolean {
    return /primary/.test(this.mode ?? '');
  }

  @attr('array') declare knownSecondaries: string[] | undefined;
  @attr('array') declare secondaries: string[] | undefined;

  // secondary attrs
  get isSecondary(): boolean {
    return /secondary/.test(this.mode ?? '');
  }
  @attr('string') declare connection_state: string | undefined;
  get modeForUrl(): string | false {
    const mode = this.mode;
    return mode === 'bootstrapping'
      ? 'bootstrapping'
      : (this.isSecondary && 'secondary') || (this.isPrimary && 'primary');
  }
  get modeForHeader(): string {
    const mode = this.mode;
    if (!mode) {
      // mode will be false or undefined if it calls the status endpoint while still setting up the cluster
      return 'loading';
    }
    return mode;
  }
  @attr('string') declare secondaryId: string | undefined;
  @attr('string') declare primaryClusterAddr: string | undefined;
  @attr('array') declare knownPrimaryClusterAddrs: string[] | undefined;
  @attr('array') declare primaries: string[] | undefined;
  @attr('string') declare state: string | undefined; //stream-wal, merkle-diff, merkle-sync, idle
  @attr('number') declare lastRemoteWAL: number | undefined;

  // attrs on primary and secondary
  @attr('number') declare lastWAL: number | undefined;
  @attr('string') declare merkleRoot: string | undefined;
  @attr('object') declare merkleSyncProgress: MerkleSyncProgress | undefined;

  get syncProgress(): { progress: number | undefined; total: number | undefined } | null {
    const { state, merkleSyncProgress } = this;
    if (state !== 'merkle-sync' || !merkleSyncProgress) {
      return null;
    }
    const { sync_total_keys, sync_progress } = merkleSyncProgress;
    return {
      progress: sync_progress,
      total: sync_total_keys,
    };
  }

  get syncProgressPercent(): number | null {
    const syncProgress = this.syncProgress;
    if (!syncProgress) {
      return null;
    }
    const { progress, total } = syncProgress;
    if (progress == null || total == null) {
      return null;
    }

    return Math.floor(100 * (progress / total));
  }

  get modeDisplay(): string {
    const displays: Record<string, string> = {
      disabled: 'Disabled',
      unknown: 'Unknown',
      bootstrapping: 'Bootstrapping',
      primary: 'Primary',
      secondary: 'Secondary',
      unsupported: 'Not supported',
    };

    return displays[this.mode ?? ''] || 'Disabled';
  }
}
