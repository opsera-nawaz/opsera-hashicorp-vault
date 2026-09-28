/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
import { service } from '@ember/service';
import { inject as controller } from '@ember/controller';
import { TOGGLE_WEB_REPL } from 'vault/utils/analytic-events';
import { FEEDBACK_SURVEY_URL } from 'vault/utils/constants/links';

import type AnalyticsService from 'vault/services/analytics';
import type CurrentClusterService from 'vault/services/current-cluster';
import type ConsoleService from 'vault/services/console';
import type ClusterController from 'vault/controllers/vault/cluster';

export default class SidebarNavComponent extends Component {
  @service declare readonly analytics: AnalyticsService;
  @service declare readonly currentCluster: CurrentClusterService;
  @service declare readonly console: ConsoleService;
  @controller('vault.cluster') declare readonly clusterController: ClusterController;

  feedbackSurveyUrl = FEEDBACK_SURVEY_URL;

  trackReplToggle = () => {
    this.analytics.trackEvent(TOGGLE_WEB_REPL, {
      namespace: 'nav',
      action: 'clicked',
      elementId: 'web-repl-toggle',
      channel: 'webpage',
    });
  };

  closeConsole = (event: KeyboardEvent) => {
    if (event?.key === 'Escape') {
      this.console.isOpen = false;
    }
  };
}
