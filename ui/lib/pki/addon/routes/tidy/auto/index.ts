/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';

import type Controller from '@ember/controller';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type { Breadcrumb } from 'vault/app-types';

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
  backend: string;
}

export default class TidyAutoIndexRoute extends Route {
  @service declare readonly secretMountPath: SecretMountPath;

  // inherits model from tidy/auto

  setupController(controller: RouteController, resolvedModel: unknown) {
    const { currentPath } = this.secretMountPath;
    super.setupController(controller, resolvedModel);
    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: currentPath, route: 'overview', model: currentPath },
      { label: 'Tidy', route: 'tidy.index', model: currentPath },
      { label: 'Auto' },
    ];
    controller.backend = currentPath;
  }
}
