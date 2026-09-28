/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import KvForm from 'vault/forms/secrets/kv';
import { service } from '@ember/service';

import type ApiService from 'vault/services/api';
import type RouterService from '@ember/routing/router-service';
import type Controller from '@ember/controller';
import type { Breadcrumb } from 'vault/app-types';
import type SecretsEngineResource from 'vault/resources/secrets/engine';

interface RouteModel {
  form: KvForm;
}

interface RouteController extends Controller {
  backend: SecretsEngineResource;
  breadcrumbs: Breadcrumb[];
}

export default class KvConfigureRoute extends Route {
  @service declare readonly api: ApiService;
  @service('app-router') declare readonly router: RouterService;

  async model(): Promise<RouteModel> {
    const backend = this.modelFor('application') as SecretsEngineResource;
    const engineConfig = await this.api.secrets.kvV2ReadConfiguration(backend.id).catch(() => undefined);
    // preserves pre-existing behavior: throws if the config read failed, since the original
    // destructured `engineConfig` unconditionally too.
    const { max_versions, cas_required, delete_version_after } = engineConfig!;

    return {
      form: new KvForm({ path: backend.id, max_versions, cas_required, delete_version_after }),
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
      { label: 'Configuration', route: 'configuration', model: backend.id },
      { label: 'Edit' },
    ];
  }
}
