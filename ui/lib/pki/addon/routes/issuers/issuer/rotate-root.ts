/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { hash } from 'rsvp';
import { parseCertificate } from 'vault/utils/parse-pki-cert';

import type Controller from '@ember/controller';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type { Breadcrumb } from 'vault/app-types';
import type { ParsedCertificateData } from 'vault/utils/parse-pki-cert';
import type { IssuerRouteModel } from 'pki/routes/issuers/issuer';

export interface RotateRootRouteModel {
  oldRoot: IssuerRouteModel;
  certData: ParsedCertificateData;
  parsingErrors: string | undefined;
  backend: string;
}

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
}

export default class PkiIssuerRotateRootRoute extends Route {
  @service declare readonly secretMountPath: SecretMountPath;

  model(): Promise<RotateRootRouteModel> {
    const oldRoot = this.modelFor('issuers.issuer') as IssuerRouteModel;
    const certData = parseCertificate(oldRoot.certificate as string);
    let parsingErrors;
    if (certData.parsing_errors && certData.parsing_errors.length > 0) {
      const errorMessage = certData.parsing_errors.map((e) => e.message).join(', ');
      parsingErrors = errorMessage;
    }
    return hash({
      oldRoot,
      certData,
      parsingErrors,
      backend: this.secretMountPath.currentPath,
    });
  }

  setupController(controller: RouteController, resolvedModel: RotateRootRouteModel) {
    super.setupController(controller, resolvedModel);
    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: this.secretMountPath.currentPath, route: 'overview', model: resolvedModel.backend },
      { label: 'Issuers', route: 'issuers.index', model: resolvedModel.backend },
      {
        label: resolvedModel.oldRoot.issuer_id ?? '',
        route: 'issuers.issuer.details',
        models: [resolvedModel.backend, resolvedModel.oldRoot.issuer_id as string],
      },
      { label: 'Rotate Root' },
    ];
  }
}
