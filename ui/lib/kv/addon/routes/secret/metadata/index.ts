/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { breadcrumbsForSecret } from 'kv/utils/kv-breadcrumbs';

import type Controller from '@ember/controller';
import type { Breadcrumb } from 'vault/app-types';
import type { MetadataRouteModel } from '../metadata';

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
}

export default class KvSecretMetadataIndexRoute extends Route {
  // model passed from parent secret route, if we need to access or intercept
  // it can retrieved via `this.modelFor('secret'), which includes the metadata model.

  setupController(controller: RouteController, resolvedModel: MetadataRouteModel): void {
    super.setupController(controller, resolvedModel);
    const breadcrumbsArray = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: resolvedModel.backend, route: 'list', model: resolvedModel.backend },
      ...breadcrumbsForSecret(resolvedModel.backend, resolvedModel.path),
      { label: 'Metadata' },
    ];

    controller.set('breadcrumbs', breadcrumbsArray);
  }
}
