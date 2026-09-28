/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';

import type Controller from '@ember/controller';
import type { Breadcrumb } from 'vault/app-types';
import type SecretMountPath from 'vault/services/secret-mount-path';

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
  mountName: string;
}

export default class KvErrorRoute extends Route {
  @service declare readonly secretMountPath: SecretMountPath;

  setupController(controller: RouteController, resolvedModel: unknown): void {
    super.setupController(controller, resolvedModel);
    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: this.secretMountPath.currentPath, route: 'list', model: this.secretMountPath.currentPath },
    ];
    controller.mountName = this.secretMountPath.currentPath;
  }
}
