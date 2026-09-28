/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import PkiIssuerForm from 'vault/forms/secrets/pki/issuers/issuer';

import type Controller from '@ember/controller';
import type ApiService from 'vault/services/api';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type { Breadcrumb } from 'vault/app-types';

export interface IssuerEditRouteModel {
  form: PkiIssuerForm;
  issuerRef: string;
}

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
}

export default class PkiIssuerEditRoute extends Route {
  @service declare readonly api: ApiService;
  @service declare readonly secretMountPath: SecretMountPath;

  async model(): Promise<IssuerEditRouteModel> {
    const { issuer_ref } = this.paramsFor('issuers/issuer') as { issuer_ref: string };
    const issuer = await this.api.secrets.pkiReadIssuer(issuer_ref, this.secretMountPath.currentPath);
    return {
      form: new PkiIssuerForm(issuer),
      issuerRef: issuer_ref,
    };
  }

  setupController(controller: RouteController, resolvedModel: IssuerEditRouteModel) {
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
      { label: 'Update' },
    ];
  }
}
