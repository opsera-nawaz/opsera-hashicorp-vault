/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';

import type Controller from '@ember/controller';
import type Transition from '@ember/routing/transition';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type { Breadcrumb } from 'vault/app-types';

interface Tab {
  label: string;
  route: string;
  model: string;
}

interface ErrorController extends Controller {
  breadcrumbs: Breadcrumb[];
  tabs: Tab[];
  title: string;
}

export default class PkiErrorRoute extends Route {
  @service declare readonly secretMountPath: SecretMountPath;

  setupController(controller: ErrorController, resolvedModel: unknown, transition: Transition) {
    super.setupController(controller, resolvedModel, transition);
    controller.breadcrumbs = [
      { label: 'Secrets', route: 'secrets', linkExternal: true },
      { label: this.secretMountPath.currentPath, route: 'overview', model: this.secretMountPath.currentPath },
    ];
    controller.tabs = [
      { label: 'Overview', route: 'overview', model: this.secretMountPath.currentPath },
      { label: 'Roles', route: 'roles.index', model: this.secretMountPath.currentPath },
      { label: 'Issuers', route: 'issuers.index', model: this.secretMountPath.currentPath },
      { label: 'Keys', route: 'keys.index', model: this.secretMountPath.currentPath },
      { label: 'Certificates', route: 'certificates.index', model: this.secretMountPath.currentPath },
      { label: 'Tidy', route: 'tidy.index', model: this.secretMountPath.currentPath },
    ];
    controller.title = this.secretMountPath.currentPath;
  }
}
