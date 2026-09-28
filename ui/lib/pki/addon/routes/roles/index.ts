/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { withConfig } from 'pki/decorators/check-issuers';
import { getCliMessage } from 'pki/routes/overview';
import { SecretsApiPkiListRolesListEnum } from '@hashicorp/vault-client-typescript';
import { paginate } from 'core/utils/paginate-list';

import type Controller from '@ember/controller';
import type ApiService from 'vault/services/api';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type { PaginatedMetadata } from 'core/utils/paginate-list';
import type SecretsEngineResource from 'vault/resources/secrets/engine';
import type { WithConfig } from 'pki/decorators/check-issuers';

export interface RolesIndexRouteModel {
  hasConfig: boolean;
  parentModel: SecretsEngineResource;
  pageFilter: string | undefined;
  roles: (string[] & PaginatedMetadata) | string[];
}

interface RouteController extends Controller {
  notConfiguredMessage: string;
  page?: string;
}

@withConfig()
export default class PkiRolesIndexRoute extends Route implements WithConfig {
  @service declare readonly api: ApiService;
  @service declare readonly secretMountPath: SecretMountPath;

  declare pkiMountHasConfig: boolean;

  queryParams = {
    page: {
      refreshModel: true,
    },
  };

  async model(params: { page?: string; pageFilter?: string }): Promise<RolesIndexRouteModel> {
    const model: RolesIndexRouteModel = {
      hasConfig: this.pkiMountHasConfig,
      parentModel: this.modelFor('roles') as SecretsEngineResource,
      pageFilter: params.pageFilter,
      roles: [],
    };

    try {
      const page = Number(params.page) || 1;
      const { keys: roles } = await this.api.secrets.pkiListRoles(
        this.secretMountPath.currentPath,
        SecretsApiPkiListRolesListEnum.TRUE
      );
      model.roles = paginate(roles ?? [], { page });
    } catch (e) {
      const { status } = await this.api.parseError(e);
      if (status !== 404) {
        throw e;
      }
    }

    return model;
  }

  setupController(controller: RouteController, resolvedModel: RolesIndexRouteModel) {
    super.setupController(controller, resolvedModel);
    controller.notConfiguredMessage = resolvedModel.roles?.length ? getCliMessage('roles') : getCliMessage();
  }

  resetController(controller: RouteController, isExiting: boolean) {
    if (isExiting) {
      controller.set('page', undefined);
    }
  }
}
