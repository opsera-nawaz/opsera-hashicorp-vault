/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { task } from 'ember-concurrency';
import { waitFor } from '@ember/test-waiters';
import { getOwner } from '@ember/owner';

import type ApiService from 'vault/services/api';
import type RouterService from '@ember/routing/router-service';

interface ReplicationModeAttrs {
  mode?: string;
  clusterId?: string;
  replicationDisabled?: boolean;
}

interface ReplicationPageModel {
  dr: { mode?: string };
  performance: { mode?: string };
  replicationMode: 'dr' | 'performance';
  replicationAttrs: ReplicationModeAttrs;
  anyReplicationEnabled: boolean;
  [key: string]: unknown;
}

interface ReplicationPageArgs {
  model: ReplicationPageModel;
}

/**
 * @module ReplicationPage
 * The `ReplicationPage` component is the parent contextual component that holds the replication-dashboard, and various replication-<name>-card components.
 * It is the top level component on routes displaying replication dashboards.
 *
 * @example
 * <ReplicationPage @model={{cluster}}/>
 *
 * @param {Object} model=null - An Ember data object that is pulled from the Ember Cluster Model.
 */

const MODE = {
  dr: 'Disaster recovery',
  performance: 'Performance',
};

export default class ReplicationPage extends Component<ReplicationPageArgs> {
  @service declare readonly api: ApiService;

  @tracked reindexingDetails: unknown = null;

  // This component renders both within and outside the replication engine so we have to dynamically look up the router
  get router(): RouterService {
    const owner = getOwner(this);
    return (owner?.lookup('service:router') ||
      owner?.lookup('service:app-router')) as unknown as RouterService;
  }

  @action onModeUpdate(_evt: unknown, replicationModeArgs: [string]): void {
    // Called on did-insert and did-update. did-insert/did-update pass their
    // positional args ({{did-insert this.onModeUpdate @model.replicationMode}})
    // as an array, which getReplicationModeStatus's own [replicationMode]
    // destructuring expects.
    this.getReplicationModeStatus.perform(replicationModeArgs);
  }

  getReplicationModeStatus = task(
    waitFor(function* (
      this: ReplicationPage,
      [replicationMode]: [string]
    ): Generator<unknown, void, unknown> {
      let resp: { data?: unknown } = {};
      if (this.isSummaryDashboard) {
        // the summary dashboard is not mode specific and will error
        // while running replication/null/status in the replication-mode adapter
        return;
      }

      try {
        // unauthenticated request -- explicitly pass empty token header
        const headers = this.api.buildHeaders({ token: '' });
        if (replicationMode === 'dr') {
          resp = (yield this.api.sys.systemReadReplicationDrStatus(headers)) as { data?: unknown };
        } else if (replicationMode === 'performance') {
          resp = (yield this.api.sys.systemReadReplicationPerformanceStatus(headers)) as {
            data?: unknown;
          };
        }
      } catch {
        // do not handle error
      } finally {
        this.reindexingDetails = resp.data;
      }
    })
  );
  get isSummaryDashboard(): boolean | string {
    const currentRoute = this.router.currentRouteName;

    // we only show the summary dashboard in the replication index route
    if (currentRoute === 'vault.cluster.replication.index') {
      const drMode = this.args.model.dr.mode;
      const performanceMode = this.args.model.performance.mode;
      return drMode === 'primary' && performanceMode === 'primary';
    }
    return '';
  }
  get formattedReplicationMode(): string {
    // dr or performance 🤯
    if (this.isSummaryDashboard) {
      return 'Disaster recovery and performance';
    }
    const mode = this.args.model.replicationMode;
    return MODE[mode];
  }
  get clusterMode(): string | undefined {
    // primary or secondary
    if (this.isSummaryDashboard) {
      // replicationAttrs does not exist when summaryDashboard
      return 'primary';
    }
    return this.args.model.replicationAttrs.mode;
  }
  get isLoadingData(): boolean {
    if (this.isSummaryDashboard) {
      return false;
    }
    const { clusterId, replicationDisabled } = this.args.model.replicationAttrs;
    if (this.clusterMode === 'bootstrapping' || (!clusterId && !replicationDisabled)) {
      // if clusterMode is bootstrapping
      // if no clusterId, the data hasn't loaded yet, wait for another status endpoint to be called
      return true;
    }
    return false;
  }
  get isSecondary(): boolean {
    return this.clusterMode === 'secondary';
  }
  get replicationDetailsSummary(): { dr?: unknown; performance?: unknown } {
    if (this.isSummaryDashboard) {
      const combinedObject: { dr?: unknown; performance?: unknown } = {};
      combinedObject.dr = this.args.model['dr'];
      combinedObject.performance = this.args.model['performance'];
      return combinedObject;
    }
    return {};
  }
  get replicationDetails(): { mode?: string; [key: string]: unknown } {
    if (this.isSummaryDashboard) {
      // Cannot return null
      return {};
    }
    const { replicationMode } = this.args.model;
    return this.args.model[replicationMode];
  }
  get isDisabled(): boolean {
    if (this.replicationDetails.mode === 'disabled' || this.replicationDetails.mode === 'primary') {
      return true;
    }
    return false;
  }
  get message(): string {
    let msg;
    if (this.args.model.anyReplicationEnabled) {
      msg = `This ${this.formattedReplicationMode} secondary has not been enabled.  You can do so from the ${this.formattedReplicationMode} Primary.`;
    } else {
      msg = `This cluster has not been enabled as a ${this.formattedReplicationMode} Secondary. You can do so by enabling replication and adding a secondary from the ${this.formattedReplicationMode} Primary.`;
    }
    return msg;
  }
}
