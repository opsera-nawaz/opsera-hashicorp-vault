/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { hash } from 'rsvp';

import type ApiService from 'vault/services/api';
import type CapabilitiesService from 'vault/services/capabilities';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type SecretsEngineResource from 'vault/resources/secrets/engine';
import type {
  PkiReadClusterConfigurationResponse,
  PkiReadUrlsConfigurationResponse,
  PkiReadCrlConfigurationResponse,
} from '@hashicorp/vault-client-typescript';

interface ConfigurationCapabilities {
  canImportBundle: boolean | undefined;
  canSetAcme: boolean | undefined;
  canSetCluster: boolean | undefined;
  canSetCrl: boolean | undefined;
  canSetUrls: boolean | undefined;
  canDeleteAllIssuers: boolean | undefined;
}

export interface ConfigurationRouteModel {
  engine: SecretsEngineResource;
  acme: unknown;
  cluster: PkiReadClusterConfigurationResponse | number | undefined;
  urls: PkiReadUrlsConfigurationResponse | number | undefined;
  crl: PkiReadCrlConfigurationResponse | number | undefined;
  capabilities: ConfigurationCapabilities;
}

export default class PkiConfigurationRoute extends Route {
  @service declare readonly api: ApiService;
  @service declare readonly capabilities: CapabilitiesService;
  @service declare readonly secretMountPath: SecretMountPath;

  async fetchCapabilities(backend: string): Promise<ConfigurationCapabilities> {
    const { pathFor } = this.capabilities;
    const pathMap = {
      import: pathFor('pkiIssuersImportBundle', { backend }),
      configAcme: pathFor('pkiConfigAcme', { backend }),
      configCluster: pathFor('pkiConfigCluster', { backend }),
      configCrl: pathFor('pkiConfigCrl', { backend }),
      configUrls: pathFor('pkiConfigUrls', { backend }),
      root: pathFor('pkiRoot', { backend }),
    };
    const perms = await this.capabilities.fetch(Object.values(pathMap));
    return {
      canImportBundle: perms[pathMap.import]?.canCreate,
      canSetAcme: perms[pathMap.configAcme]?.canUpdate,
      canSetCluster: perms[pathMap.configCluster]?.canUpdate,
      canSetCrl: perms[pathMap.configCrl]?.canUpdate,
      canSetUrls: perms[pathMap.configUrls]?.canUpdate,
      canDeleteAllIssuers: perms[pathMap.root]?.canDelete,
    };
  }

  model(): Promise<ConfigurationRouteModel> {
    const engine = this.modelFor('application') as SecretsEngineResource;
    const errorHandler = (e: { response?: { status?: number } }) => e.response?.status;
    const { currentPath } = this.secretMountPath;

    return hash({
      engine,
      acme: this.api.secrets
        .pkiReadAcmeConfiguration(currentPath)
        .then((resp) => resp.data) // response type is VoidResponse
        .catch(errorHandler),
      cluster: this.api.secrets.pkiReadClusterConfiguration(currentPath).catch(errorHandler),
      urls: this.api.secrets.pkiReadUrlsConfiguration(currentPath).catch(errorHandler),
      crl: this.api.secrets.pkiReadCrlConfiguration(currentPath).catch(errorHandler),
      capabilities: this.fetchCapabilities(currentPath),
    });
  }
}
