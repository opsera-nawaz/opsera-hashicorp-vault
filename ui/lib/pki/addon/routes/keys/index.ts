/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { withConfig } from 'pki/decorators/check-issuers';
import { PKI_DEFAULT_EMPTY_STATE_MSG } from 'pki/routes/overview';
import { SecretsApiPkiListKeysListEnum } from '@hashicorp/vault-client-typescript';
import { paginate } from 'core/utils/paginate-list';

import type Controller from '@ember/controller';
import type ApiService from 'vault/services/api';
import type CapabilitiesService from 'vault/services/capabilities';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type { PaginatedMetadata } from 'core/utils/paginate-list';
import type { PkiReadKeyResponse } from '@hashicorp/vault-client-typescript';
import type { Capabilities, CapabilitiesMap, Breadcrumb } from 'vault/app-types';
import type SecretsEngineResource from 'vault/resources/secrets/engine';
import type { WithConfig } from 'pki/decorators/check-issuers';

export type PkiKeyListItem = Partial<PkiReadKeyResponse> & { key_id: string };

interface KeysCapabilities {
  canImportKeys: boolean | undefined;
  canGenerateKeys: boolean | undefined;
  keyPermsById: Record<string, Capabilities>;
}

export interface KeysIndexRouteModel extends Partial<KeysCapabilities> {
  hasConfig: boolean;
  parentModel: SecretsEngineResource;
  keys: (PkiKeyListItem[] & PaginatedMetadata) | PkiKeyListItem[];
}

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
  notConfiguredMessage: string;
  page?: string;
}

@withConfig()
export default class PkiKeysIndexRoute extends Route implements WithConfig {
  @service declare readonly secretMountPath: SecretMountPath;
  @service declare readonly api: ApiService;
  @service declare readonly capabilities: CapabilitiesService;

  declare pkiMountHasConfig: boolean;

  queryParams = {
    page: {
      refreshModel: true,
    },
  };

  async fetchCapabilities(keys: PkiKeyListItem[]): Promise<KeysCapabilities> {
    const { pathFor } = this.capabilities;
    const backend = this.secretMountPath.currentPath;
    const keyPathsById = this.keyPathsById(backend, keys);
    const pathMap: Record<string, string> = {
      import: pathFor('pkiKeysImport', { backend }),
      generate: pathFor('pkiKeysGenerate', { backend }),
      ...keyPathsById,
    };

    const apiPaths = Object.values(pathMap);
    const perms = await this.capabilities.fetch(apiPaths, {
      routeForCache: 'vault.cluster.secrets.backend.pki.keys',
    });
    return {
      canImportKeys: perms[pathMap['import'] as string]?.canUpdate,
      canGenerateKeys: perms[pathMap['generate'] as string]?.canUpdate,
      keyPermsById: this.keyCapabilitiesById(keyPathsById, perms),
    };
  }

  async model(params: { page?: string }): Promise<KeysIndexRouteModel> {
    const page = Number(params.page) || 1;
    const model: KeysIndexRouteModel = {
      hasConfig: this.pkiMountHasConfig,
      parentModel: this.modelFor('keys') as SecretsEngineResource,
      keys: [],
    };

    try {
      const response = await this.api.secrets.pkiListKeys(
        this.secretMountPath.currentPath,
        SecretsApiPkiListKeysListEnum.TRUE
      );
      const keys = this.api.keyInfoToArray<PkiKeyListItem>(response, 'key_id');
      const capabilities = await this.fetchCapabilities(keys);
      Object.assign(model, { ...capabilities, keys: paginate(keys, { page }) });
    } catch (e) {
      const { status } = await this.api.parseError(e);
      if (status === 404) {
        model.keys = [];
      } else {
        throw e;
      }
    }

    return model;
  }

  setupController(controller: RouteController, resolvedModel: KeysIndexRouteModel) {
    super.setupController(controller, resolvedModel);
    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: this.secretMountPath.currentPath, route: 'overview', model: resolvedModel.parentModel.id },
      { label: 'Keys', route: 'keys.index', model: resolvedModel.parentModel.id },
    ];
    controller.notConfiguredMessage = PKI_DEFAULT_EMPTY_STATE_MSG;
  }

  resetController(controller: RouteController, isExiting: boolean) {
    if (isExiting) {
      controller.set('page', undefined);
    }
  }

  keyPathsById(backend: string, keys: PkiKeyListItem[]): Record<string, string> {
    // Construct API path for each key in the list
    return Object.fromEntries(
      keys.map(({ key_id: keyId }) => [keyId, this.capabilities.pathFor('pkiKey', { backend, keyId })])
    );
  }

  keyCapabilitiesById(keyPathsById: Record<string, string>, perms: CapabilitiesMap): Record<string, Capabilities> {
    // Iterate over key ids and return an object with Capabilities as their value
    return Object.fromEntries(
      Object.entries(keyPathsById)
        .filter(([, apiPath]) => apiPath in perms)
        // apiPath is guaranteed present in perms by the filter above
        .map(([keyId, apiPath]): [string, Capabilities] => [keyId, perms[apiPath] as Capabilities])
    );
  }
}
