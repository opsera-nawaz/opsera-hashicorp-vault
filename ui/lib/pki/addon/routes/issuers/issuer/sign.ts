/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import PkiIssuersSignIntermediateForm from 'vault/forms/secrets/pki/issuers/sign-intermediate';

import type Controller from '@ember/controller';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type { Breadcrumb } from 'vault/app-types';

export interface IssuerSignRouteModel {
  form: PkiIssuersSignIntermediateForm;
  issuerRef: string;
}

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
}

export default class PkiIssuerSignRoute extends Route {
  @service declare readonly secretMountPath: SecretMountPath;

  model(): IssuerSignRouteModel {
    const { issuer_ref } = this.paramsFor('issuers/issuer') as { issuer_ref: string };
    return {
      form: new PkiIssuersSignIntermediateForm({}, { isNew: true }),
      issuerRef: issuer_ref,
    };
  }
  setupController(controller: RouteController, resolvedModel: IssuerSignRouteModel) {
    super.setupController(controller, resolvedModel);
    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: this.secretMountPath.currentPath, route: 'overview', model: this.secretMountPath.currentPath },
      { label: 'Issuers', route: 'issuers.index', model: this.secretMountPath.currentPath },
      {
        label: resolvedModel.issuerRef,
        route: 'issuers.issuer.details',
        models: [this.secretMountPath.currentPath, resolvedModel.issuerRef],
      },
      { label: 'Sign Intermediate' },
    ];
  }
}
