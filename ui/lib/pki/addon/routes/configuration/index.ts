/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { withConfig } from 'pki/decorators/check-issuers';
import { PKI_DEFAULT_EMPTY_STATE_MSG } from 'pki/routes/overview';
import { service } from '@ember/service';

import type Controller from '@ember/controller';
import type RouterService from '@ember/routing/router-service';
import type SecretsEngineResource from 'vault/resources/secrets/engine';
import type { Breadcrumb } from 'vault/app-types';
import type { ConfigurationRouteModel } from 'pki/routes/configuration';
import type { WithConfig } from 'pki/decorators/check-issuers';

export interface ConfigurationIndexRouteModel extends ConfigurationRouteModel {
  hasConfig: boolean;
  mountConfig: SecretsEngineResource;
}

interface RouteController extends Controller {
  notConfiguredMessage: string;
  breadcrumbs: Breadcrumb[];
}

@withConfig()
export default class ConfigurationIndexRoute extends Route implements WithConfig {
  @service('app-router') declare readonly router: RouterService;

  declare pkiMountHasConfig: boolean;

  async model(): Promise<ConfigurationIndexRouteModel> {
    return {
      hasConfig: this.pkiMountHasConfig,
      mountConfig: this.modelFor('application') as SecretsEngineResource,
      ...(this.modelFor('configuration') as ConfigurationRouteModel),
    };
  }

  afterModel(resolvedModel: ConfigurationIndexRouteModel) {
    if (!resolvedModel.hasConfig) {
      this.router.transitionTo('vault.cluster.secrets.backend.pki.configuration.create');
    }
  }

  setupController(controller: RouteController, resolvedModel: ConfigurationIndexRouteModel) {
    super.setupController(controller, resolvedModel);

    controller.notConfiguredMessage = PKI_DEFAULT_EMPTY_STATE_MSG;
    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: resolvedModel.engine.id, route: 'overview', model: resolvedModel.engine.id },
      { label: 'Configuration' },
    ];
  }
}
