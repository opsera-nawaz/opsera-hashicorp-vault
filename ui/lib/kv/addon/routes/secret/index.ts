/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { breadcrumbsForSecret } from 'kv/utils/kv-breadcrumbs';

import type Controller from '@ember/controller';
import type RouterService from '@ember/routing/router-service';
import type { Breadcrumb } from 'vault/app-types';
import type { SecretRouteModel } from '../secret';

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
}

export default class SecretIndex extends Route {
  @service('app-router') declare readonly router: RouterService;

  setupController(controller: RouteController, resolvedModel: SecretRouteModel): void {
    super.setupController(controller, resolvedModel);
    const breadcrumbsArray = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: resolvedModel.backend, route: 'list', model: resolvedModel.backend },
      ...breadcrumbsForSecret(resolvedModel.backend, resolvedModel.path, true),
    ];
    controller.breadcrumbs = breadcrumbsArray;
  }
}
