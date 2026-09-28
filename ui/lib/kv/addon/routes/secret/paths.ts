/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { breadcrumbsForSecret } from 'kv/utils/kv-breadcrumbs';

import type Controller from '@ember/controller';
import type { Breadcrumb } from 'vault/app-types';
import type { SecretRouteModel } from '../secret';

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
}

export default class KvSecretPathsRoute extends Route {
  setupController(controller: RouteController, resolvedModel: SecretRouteModel): void {
    super.setupController(controller, resolvedModel);

    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: resolvedModel.backend, route: 'list', model: resolvedModel.backend },
      ...breadcrumbsForSecret(resolvedModel.backend, resolvedModel.path),
      { label: 'Paths' },
    ];
  }
}
