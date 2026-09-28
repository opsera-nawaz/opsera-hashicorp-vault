/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { pathIsDirectory, breadcrumbsForSecret } from 'kv/utils/kv-breadcrumbs';
import { paginate } from 'core/utils/paginate-list';
import { SecretsApiKvV2ListListEnum } from '@hashicorp/vault-client-typescript';

import type ApiService from 'vault/services/api';
import type CapabilitiesService from 'vault/services/capabilities';
import type Controller from '@ember/controller';
import type RouterService from '@ember/routing/router-service';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type { Breadcrumb, Capabilities } from 'vault/app-types';
import type { PaginatedMetadata } from 'core/utils/paginate-list';
import type SecretsEngineResource from 'vault/resources/secrets/engine';

interface RouteParams {
  page?: string;
  pageFilter?: string;
  path_to_secret?: string;
}

interface RouteModel {
  backendModel: SecretsEngineResource;
  secrets: 403 | (string[] & Partial<PaginatedMetadata>);
  backend: string;
  pathToSecret: string;
  filterValue: string | undefined;
  pageFilter: string | undefined;
  capabilities: Capabilities;
  failedDirectoryQuery?: boolean;
}

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
  pageFilter?: string;
  page?: string;
}

export default class KvSecretsListRoute extends Route {
  @service('app-router') declare readonly router: RouterService;
  @service declare readonly secretMountPath: SecretMountPath;
  @service declare readonly api: ApiService;
  @service declare readonly capabilities: CapabilitiesService;

  queryParams = {
    pageFilter: {
      refreshModel: true,
    },
    page: {
      refreshModel: true,
    },
  };

  async fetchMetadata(
    backend: string,
    pathToSecret: string,
    params: RouteParams
  ): Promise<403 | (string[] & Partial<PaginatedMetadata>)> {
    try {
      // kvV2List => GET /:secret-mount-path/metadata/:secret_path/?list=true
      // This request can either list secrets at the mount root or for a specified :secret_path.
      // Since :secret_path already contains a trailing slash, e.g. /metadata/my-secret//
      // the request URL is sanitized by the api service to remove duplicate slashes.
      const { keys } = await this.api.secrets.kvV2List(
        pathToSecret,
        backend,
        SecretsApiKvV2ListListEnum.TRUE
      );
      return paginate(keys ?? [], { page: Number(params.page) || 1, filter: params.pageFilter });
    } catch (error) {
      const { status, response } = await this.api.parseError(error);
      if (status === 403 && !response?.isControlGroupError) {
        return 403;
      }
      if (status === 404) {
        return [];
      }
      throw error;
    }
  }

  getPathToSecret(pathParam: string | undefined): string {
    if (!pathParam) return '';
    // links and routing assumes pathToParam includes trailing slash
    // users may want to include a percent-encoded octet like %2f in their path. Example: 'foo%2fbar' or non-data octets like 'foo%bar'.
    // we are assuming the user intended to include these characters in their path and we should not decode them.
    return pathIsDirectory(pathParam) ? pathParam : `${pathParam}/`;
  }

  async model(params: RouteParams): Promise<RouteModel> {
    const { pageFilter, path_to_secret } = params;
    const pathToSecret = this.getPathToSecret(path_to_secret);
    const backend = this.secretMountPath.currentPath;
    const filterValue = pathToSecret ? (pageFilter ? pathToSecret + pageFilter : pathToSecret) : pageFilter;
    const secrets = await this.fetchMetadata(backend, pathToSecret, params);
    const capabilities = await this.capabilities.for(
      'kvMetadata',
      { backend, path: path_to_secret },
      { routeForCache: 'vault.cluster.secrets.backend.kv' }
    );
    const backendModel = this.modelFor('application') as SecretsEngineResource;

    return {
      backendModel,
      secrets,
      backend,
      pathToSecret,
      filterValue,
      pageFilter,
      capabilities,
    };
  }

  setupController(controller: RouteController, resolvedModel: RouteModel): void {
    super.setupController(controller, resolvedModel);
    // renders alert inline error for overview card
    resolvedModel.failedDirectoryQuery =
      resolvedModel.secrets === 403 && pathIsDirectory(resolvedModel.pathToSecret);

    let breadcrumbsArray: Breadcrumb[] = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
    ];
    // if on top level don't link the engine breadcrumb label, but if within a directory, do link back to top level.
    if (this.routeName === 'list') {
      breadcrumbsArray.push({ label: resolvedModel.backend });
    } else {
      breadcrumbsArray = [
        ...breadcrumbsArray,
        { label: resolvedModel.backend, route: 'list', model: resolvedModel.backend },
        ...breadcrumbsForSecret(resolvedModel.backend, resolvedModel.pathToSecret, true),
      ];
    }

    controller.set('breadcrumbs', breadcrumbsArray);
  }

  resetController(controller: RouteController, isExiting: boolean): void {
    if (isExiting) {
      controller.set('pageFilter', undefined);
      controller.set('page', undefined);
    }
  }
}
