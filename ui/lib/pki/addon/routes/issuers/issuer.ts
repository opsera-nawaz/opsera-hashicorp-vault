/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { verifyCertificates, parseCertificate } from 'vault/utils/parse-pki-cert';

import type Controller from '@ember/controller';
import type ApiService from 'vault/services/api';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type { PkiReadIssuerResponse } from '@hashicorp/vault-client-typescript';
import type { ParsedCertificateData } from 'vault/utils/parse-pki-cert';
import type { Breadcrumb } from 'vault/app-types';

export type IssuerRouteModel = PkiReadIssuerResponse & {
  isRoot: boolean;
  parsedCertificate: ParsedCertificateData;
};

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
}

export default class PkiIssuerIndexRoute extends Route {
  @service declare readonly api: ApiService;
  @service declare readonly secretMountPath: SecretMountPath;

  model(): Promise<IssuerRouteModel> {
    const { issuer_ref } = this.paramsFor('issuers/issuer') as { issuer_ref: string };
    return this.api.secrets
      .pkiReadIssuer(issuer_ref, this.secretMountPath.currentPath)
      .then(async (issuer) => {
        const isRoot = await verifyCertificates(issuer.certificate as string, issuer.certificate as string);
        const parsedCertificate = parseCertificate(issuer.certificate as string);
        return {
          ...issuer,
          isRoot,
          parsedCertificate,
        };
      });
  }

  setupController(controller: RouteController, resolvedModel: IssuerRouteModel) {
    super.setupController(controller, resolvedModel);
    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: this.secretMountPath.currentPath, route: 'overview', model: this.secretMountPath.currentPath },
      { label: 'Issuers', route: 'issuers.index', model: this.secretMountPath.currentPath },
    ];
  }
}
