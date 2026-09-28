/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';

import type Controller from '@ember/controller';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type { Breadcrumb } from 'vault/app-types';
import type { IssuerRouteModel } from 'pki/routes/issuers/issuer';

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
}

export default class PkiIssuerCrossSignRoute extends Route {
  @service declare readonly secretMountPath: SecretMountPath;

  model(): IssuerRouteModel {
    return this.modelFor('issuers.issuer') as IssuerRouteModel;
  }

  setupController(controller: RouteController, resolvedModel: IssuerRouteModel) {
    super.setupController(controller, resolvedModel);

    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: this.secretMountPath.currentPath, route: 'overview', model: this.secretMountPath.currentPath },
      { label: 'Issuers', route: 'issuers.index', model: this.secretMountPath.currentPath },
      {
        label: resolvedModel.issuer_id ?? '',
        route: 'issuers.issuer.details',
        models: [this.secretMountPath.currentPath, resolvedModel.issuer_id as string],
      },
      { label: 'Cross-sign' },
    ];
  }
}
