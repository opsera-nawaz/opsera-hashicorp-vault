/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { breadcrumbsForSecret } from 'kv/utils/kv-breadcrumbs';
import { service } from '@ember/service';

import type Controller from '@ember/controller';
import type RouterService from '@ember/routing/router-service';
import type { Breadcrumb } from 'vault/app-types';
import type { SecretRouteModel } from '../secret';

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
}

export default class SecretPatch extends Route {
  @service('app-router') declare readonly router: RouterService;

  setupController(controller: RouteController, resolvedModel: SecretRouteModel): void {
    super.setupController(controller, resolvedModel);
    const breadcrumbsArray = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: resolvedModel.backend, route: 'list', model: resolvedModel.backend },
      ...breadcrumbsForSecret(resolvedModel.backend, resolvedModel.path),
      { label: 'Patch' },
    ];
    controller.breadcrumbs = breadcrumbsArray;
  }

  // isPatchAllowed is true if (1) the version is enterprise, (2) a user has "patch" secret + "read" subkeys capabilities, (3) latest secret version is not deleted or destroyed
  redirect(model: SecretRouteModel): void {
    if (!model.isPatchAllowed) {
      this.router.transitionTo('vault.cluster.secrets.backend.kv.secret.index', model.path);
    }
  }
}
