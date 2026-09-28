/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';

import type Controller from '@ember/controller';
import type ApiService from 'vault/services/api';
import type CapabilitiesService from 'vault/services/capabilities';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type { PkiReadCertResponse } from '@hashicorp/vault-client-typescript';
import type { Breadcrumb } from 'vault/app-types';

export interface CertificateDetailsRouteModel {
  certificate: PkiReadCertResponse & { serial_number: string };
  canRevoke: boolean;
}

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
}

export default class PkiCertificateDetailsRoute extends Route {
  @service declare readonly api: ApiService;
  @service declare readonly secretMountPath: SecretMountPath;
  @service declare readonly capabilities: CapabilitiesService;

  async model(): Promise<CertificateDetailsRouteModel> {
    const { serial } = this.paramsFor('certificates/certificate') as { serial: string };
    const certificate = await this.api.secrets.pkiReadCert(serial, this.secretMountPath.currentPath);
    const { canCreate } = await this.capabilities.for('pkiRevoke', {
      backend: this.secretMountPath.currentPath,
    });

    return {
      certificate: { serial_number: serial, ...certificate },
      canRevoke: canCreate,
    };
  }

  setupController(controller: RouteController, model: CertificateDetailsRouteModel) {
    super.setupController(controller, model);
    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: this.secretMountPath.currentPath, route: 'overview', model: this.secretMountPath.currentPath },
      { label: 'Certificates', route: 'certificates.index', model: this.secretMountPath.currentPath },
      { label: model.certificate.serial_number },
    ];
  }
}
