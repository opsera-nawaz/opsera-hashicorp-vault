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
import type { Breadcrumb } from 'vault/app-types';
import type { IssuerRouteModel } from 'pki/routes/issuers/issuer';

interface DetailsCapabilities {
  canRotate: boolean | undefined;
  canCrossSign: boolean | undefined;
  canSignIntermediate: boolean | undefined;
  canConfigure: boolean | undefined;
}

export interface IssuerDetailsRouteModel extends DetailsCapabilities {
  issuer: IssuerRouteModel;
  pem: string | Blob | null;
  der: string | Blob | null;
  isRotatable: boolean;
  backend: string;
}

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
}

export default class PkiIssuerDetailsRoute extends Route {
  @service declare readonly api: ApiService;
  @service declare readonly secretMountPath: SecretMountPath;
  @service declare readonly capabilities: CapabilitiesService;

  async fetchCapabilities(): Promise<DetailsCapabilities> {
    const { pathFor } = this.capabilities;
    const backend = this.secretMountPath.currentPath;
    const { issuer_id: issuerId } = this.modelFor('issuers.issuer') as IssuerRouteModel;

    const pathMap = {
      rotateExported: pathFor('pkiRootRotate', { backend, type: 'exported' }),
      rotateInternal: pathFor('pkiRootRotate', { backend, type: 'internal' }),
      rotateExisting: pathFor('pkiRootRotate', { backend, type: 'existing' }),
      crossSign: pathFor('pkiIntermediateCrossSign', { backend }),
      signIntermediate: pathFor('pkiIssuerSignIntermediate', { backend, issuerId }),
      configure: pathFor('pkiIssuer', { backend, issuerId }),
    };
    const perms = await this.capabilities.fetch(Object.values(pathMap));

    const canRotate =
      perms[pathMap.rotateExported]?.canUpdate ||
      perms[pathMap.rotateInternal]?.canUpdate ||
      perms[pathMap.rotateExisting]?.canUpdate;

    return {
      canRotate,
      canCrossSign: perms[pathMap.crossSign]?.canUpdate,
      canSignIntermediate: perms[pathMap.signIntermediate]?.canUpdate,
      canConfigure: perms[pathMap.configure]?.canUpdate,
    };
  }

  async model(): Promise<IssuerDetailsRouteModel> {
    const issuer = this.modelFor('issuers.issuer') as IssuerRouteModel;
    const { canRotate, canCrossSign, canSignIntermediate, canConfigure } = await this.fetchCapabilities();

    return {
      issuer,
      pem: await this.fetchCertByFormat(issuer.issuer_id as string, 'pem'),
      der: await this.fetchCertByFormat(issuer.issuer_id as string, 'der'),
      isRotatable: Boolean(issuer.isRoot && issuer.key_id),
      backend: this.secretMountPath.currentPath,
      canRotate,
      canCrossSign,
      canSignIntermediate,
      canConfigure,
    };
  }

  setupController(controller: RouteController, resolvedModel: IssuerDetailsRouteModel) {
    super.setupController(controller, resolvedModel);
    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: this.secretMountPath.currentPath, route: 'overview', model: resolvedModel.backend },
      { label: 'Issuers', route: 'issuers.index', model: resolvedModel.backend },
      { label: resolvedModel.issuer.issuer_id ?? '' },
    ];
  }

  /**
   * @private fetches cert by format so it's available for download
   */
  async fetchCertByFormat(issuerId: string, format: 'der' | 'pem'): Promise<string | Blob | null> {
    try {
      const path = `/${this.secretMountPath.currentPath}/issuer/${issuerId}/${format}`;
      const response = await this.api.request.get(path);
      const body = format === 'der' ? 'blob' : 'text';
      return response[body]();
    } catch (e) {
      return null;
    }
  }
}
