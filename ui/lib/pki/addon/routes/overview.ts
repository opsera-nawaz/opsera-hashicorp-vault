/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { withConfig } from 'pki/decorators/check-issuers';
import { hash } from 'rsvp';
import {
  SecretsApiPkiListCertsListEnum,
  SecretsApiPkiListRolesListEnum,
  SecretsApiPkiListIssuersListEnum,
} from '@hashicorp/vault-client-typescript';

import type Controller from '@ember/controller';
import type ApiService from 'vault/services/api';
import type CapabilitiesService from 'vault/services/capabilities';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type SecretsEngineResource from 'vault/resources/secrets/engine';
import type { WithConfig } from 'pki/decorators/check-issuers';

export const PKI_DEFAULT_EMPTY_STATE_MSG =
  "This PKI mount hasn't yet been configured with a certificate issuer.";

export const getCliMessage = (msg?: string) => {
  if (!msg) return PKI_DEFAULT_EMPTY_STATE_MSG;

  return `${PKI_DEFAULT_EMPTY_STATE_MSG} There are existing ${msg}. Use the CLI to perform any operations with them until an issuer is configured.`;
};

type ListResult = string[] | undefined | null;

interface OverviewCapabilities {
  canListCertificates: boolean | undefined;
  canListRoles: boolean | undefined;
}

export interface OverviewRouteModel extends OverviewCapabilities {
  hasConfig: boolean;
  engine: SecretsEngineResource;
  roles: ListResult;
  issuers: ListResult;
  certificates: ListResult;
}

interface OverviewController extends Controller {
  notConfiguredMessage: string;
}

@withConfig()
export default class PkiOverviewRoute extends Route implements WithConfig {
  @service declare readonly api: ApiService;
  @service declare readonly capabilities: CapabilitiesService;
  @service declare readonly secretMountPath: SecretMountPath;

  declare pkiMountHasConfig: boolean;

  async fetchAllCertificates(): Promise<ListResult> {
    try {
      const { keys } = await this.api.secrets.pkiListCerts(
        this.secretMountPath.currentPath,
        SecretsApiPkiListCertsListEnum.TRUE
      );
      return keys;
    } catch (e) {
      const { status } = await this.api.parseError(e);
      // If there was a permissions (403) or some other error
      // swallow because this data is for rendering overview cards
      return status === 404 ? [] : null;
    }
  }

  async fetchAllRoles(): Promise<ListResult> {
    try {
      const { keys } = await this.api.secrets.pkiListRoles(
        this.secretMountPath.currentPath,
        SecretsApiPkiListRolesListEnum.TRUE
      );
      return keys;
    } catch (e) {
      const { status } = await this.api.parseError(e);
      // If there was a permissions (403) or some other error
      // swallow because this data is for rendering overview cards
      return status === 404 ? [] : null;
    }
  }

  async fetchAllIssuers(): Promise<ListResult> {
    try {
      const { keys } = await this.api.secrets.pkiListIssuers(
        this.secretMountPath.currentPath,
        SecretsApiPkiListIssuersListEnum.TRUE
      );
      return keys;
    } catch (e) {
      const { status } = await this.api.parseError(e);
      return status === 404 ? [] : null;
    }
  }

  async fetchCapabilities(): Promise<OverviewCapabilities> {
    const { pathFor } = this.capabilities;
    const backend = this.secretMountPath.currentPath;
    // the issuers list endpoint is unauthenticated so we do not need to check capabilities for it
    const pathMap = {
      certificates: pathFor('pkiCertificates', { backend }),
      roles: pathFor('pkiRoles', { backend }),
    };
    const apiPaths = Object.values(pathMap);
    const perms = await this.capabilities.fetch(apiPaths, {
      routeForCache: 'vault.cluster.secrets.backend.pki.overview',
    });
    return {
      canListCertificates: perms[pathMap.certificates]?.canList,
      canListRoles: perms[pathMap.roles]?.canList,
    };
  }

  async model(): Promise<OverviewRouteModel> {
    const { canListCertificates, canListRoles } = await this.fetchCapabilities();
    return hash({
      hasConfig: this.pkiMountHasConfig,
      engine: this.modelFor('application') as SecretsEngineResource,
      roles: canListRoles ? this.fetchAllRoles() : null,
      issuers: this.fetchAllIssuers(),
      certificates: canListCertificates ? this.fetchAllCertificates() : null,
      canListCertificates,
      canListRoles,
    });
  }

  setupController(controller: OverviewController, resolvedModel: OverviewRouteModel) {
    super.setupController(controller, resolvedModel);
    const roles = resolvedModel.roles;
    const certificates = resolvedModel.certificates;

    controller.notConfiguredMessage = getCliMessage();

    if (roles?.length) controller.notConfiguredMessage = getCliMessage('roles');
    if (certificates?.length) controller.notConfiguredMessage = getCliMessage('certificates');
    if (roles?.length && certificates?.length)
      controller.notConfiguredMessage = getCliMessage('roles and certificates');
  }
}
