/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { NavSection, RouteName } from 'core/helpers/display-nav-item';
import {
  NAV_DASHBOARD,
  NAV_SECRETS,
  NAV_RESILIENCE_RECOVERY,
  NAV_ACCESS_CONTROL,
  NAV_OPERATIONAL_TOOLS,
  NAV_REPORTING,
  NAV_CLIENT_COUNT,
  NAV_BILLING_METRICS,
  NAV_RAFT_STORAGE,
} from 'vault/utils/analytic-events';
import type { AnalyticsEventName } from 'vault/utils/analytic-events';

import type AnalyticsService from 'vault/services/analytics';
import type CurrentClusterService from 'vault/services/current-cluster';
import type FlagsService from 'vault/services/flags';
import type VersionService from 'vault/services/version';
import type NamespaceService from 'vault/services/namespace';
import type PermissionsService from 'vault/services/permissions';
import type ClusterModel from 'vault/models/cluster';

export default class SidebarNavClusterComponent extends Component {
  @service declare readonly analytics: AnalyticsService;
  @service declare readonly currentCluster: CurrentClusterService;
  @service declare readonly flags: FlagsService;
  @service declare readonly version: VersionService;
  @service declare readonly namespace: NamespaceService;
  @service declare readonly permissions: PermissionsService;

  // Event name constants for template access
  navEvents = {
    dashboard: NAV_DASHBOARD,
    secrets: NAV_SECRETS,
    resilienceRecovery: NAV_RESILIENCE_RECOVERY,
    accessControl: NAV_ACCESS_CONTROL,
    operationalTools: NAV_OPERATIONAL_TOOLS,
    reporting: NAV_REPORTING,
    clientCount: NAV_CLIENT_COUNT,
    billingMetrics: NAV_BILLING_METRICS,
    raftStorage: NAV_RAFT_STORAGE,
  };

  navSection = {
    resilienceAndRecovery: NavSection.RESILIENCE_AND_RECOVERY,
    reporting: NavSection.REPORTING,
    clientCount: NavSection.CLIENT_COUNT,
  };

  routeName = {
    vaultUsage: RouteName.VAULT_USAGE,
    billingDashboard: RouteName.BILLING_DASHBOARD,
  };

  get cluster(): ClusterModel | null {
    return this.currentCluster.cluster as ClusterModel | null;
  }

  get hasChrootNamespace() {
    return this.cluster?.hasChrootNamespace;
  }

  get isRootNamespace() {
    // should only return true if we're in the true root namespace
    return this.namespace.inRootNamespace && !this.hasChrootNamespace;
  }

  get showSecretsSync() {
    // always show for HVD managed clusters
    if (this.flags.isHvdManaged) return true;

    if (this.flags.secretsSyncIsActivated) {
      // activating the feature requires different permissions than using the feature.
      // we want to show the link to allow activation regardless of permissions to sys/sync
      // and only check permissions if the feature has been activated
      return this.permissions.hasNavPermission('sync');
    }

    // otherwise we show the link depending on whether or not the feature exists
    return this.version.hasSecretsSync;
  }

  get accessRoute() {
    if (this.permissions.hasNavPermission('policies')) {
      // policies are nested under their type (e.g. vault.cluster.policies.acl), not a dynamic segment
      const [policyType] = this.routeParamsFor('policies')?.models || [];
      return `vault.cluster.policies.${policyType || 'acl'}`;
    }

    if (this.permissions.hasNavPermission('access')) {
      // non-null: hasNavPermission('access') being true guarantees a matching path exists
      return this.permissions.navPathParams('access')!.route;
    }

    return null;
  }

  get accessRouteModels() {
    if (this.permissions.hasNavPermission('policies')) {
      return null;
    }

    if (this.permissions.hasNavPermission('access')) {
      return this.routeParamsFor('access')?.models;
    }

    return null;
  }

  routeParamsFor(routeName: string) {
    return this.permissions.navPathParams(routeName);
  }

  @action
  trackNavClick(eventName: AnalyticsEventName, elementId: string, cta: string): void {
    this.analytics.trackEvent(eventName, {
      namespace: 'nav',
      action: 'clicked',
      elementId,
      CTA: cta,
      channel: 'webpage',
    });
  }
}
