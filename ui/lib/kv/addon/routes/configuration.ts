/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';

import type { KvV2ReadConfigurationResponse } from '@hashicorp/vault-client-typescript';
import type ApiService from 'vault/services/api';
import type Controller from '@ember/controller';
import type { Breadcrumb } from 'vault/app-types';
import type SecretsEngineResource from 'vault/resources/secrets/engine';

type RouteModel = Partial<KvV2ReadConfigurationResponse>;

interface RouteController extends Controller {
  backend: SecretsEngineResource;
  breadcrumbs: Breadcrumb[];
}

export default class KvConfigurationRoute extends Route {
  @service declare readonly api: ApiService;

  async model(): Promise<RouteModel> {
    const backend = this.modelFor('application') as SecretsEngineResource;
    // display mount config if engine config request fails
    const engineConfig = await this.api.secrets.kvV2ReadConfiguration(backend.id).catch(() => undefined);

    return {
      ...engineConfig,
    };
  }

  setupController(controller: RouteController, resolvedModel: RouteModel): void {
    super.setupController(controller, resolvedModel);
    const backend = this.modelFor('application') as SecretsEngineResource;
    controller.backend = backend;
    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: backend.id, route: 'list', model: backend.id },
      { label: 'Configuration' },
    ];
  }
}
