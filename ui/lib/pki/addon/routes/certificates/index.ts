/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { withConfig } from 'pki/decorators/check-issuers';
import { getCliMessage } from 'pki/routes/overview';
import { SecretsApiPkiListCertsListEnum } from '@hashicorp/vault-client-typescript';
import { paginate } from 'core/utils/paginate-list';

import type Controller from '@ember/controller';
import type ApiService from 'vault/services/api';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type { PaginatedMetadata } from 'core/utils/paginate-list';
import type SecretsEngineResource from 'vault/resources/secrets/engine';
import type { WithConfig } from 'pki/decorators/check-issuers';

export interface CertificatesIndexRouteModel {
  hasConfig: boolean;
  parentModel: SecretsEngineResource;
  pageFilter: string | undefined;
  certificates: (string[] & PaginatedMetadata) | string[];
}

interface RouteController extends Controller {
  notConfiguredMessage: string;
  page?: string;
}

@withConfig()
export default class PkiCertificatesIndexRoute extends Route implements WithConfig {
  @service declare readonly secretMountPath: SecretMountPath;
  @service declare readonly api: ApiService;

  declare pkiMountHasConfig: boolean;

  queryParams = {
    page: {
      refreshModel: true,
    },
  };

  async model(params: { page?: string; pageFilter?: string }): Promise<CertificatesIndexRouteModel> {
    const model: CertificatesIndexRouteModel = {
      hasConfig: this.pkiMountHasConfig,
      parentModel: this.modelFor('certificates') as SecretsEngineResource,
      pageFilter: params.pageFilter,
      certificates: [],
    };

    try {
      const page = Number(params.page) || 1;
      const { keys: certificates } = await this.api.secrets.pkiListCerts(
        this.secretMountPath.currentPath,
        SecretsApiPkiListCertsListEnum.TRUE
      );
      model.certificates = paginate(certificates ?? [], { page });
    } catch (e) {
      const { status } = await this.api.parseError(e);
      if (status !== 404) {
        throw e;
      }
    }

    return model;
  }

  setupController(controller: RouteController, resolvedModel: CertificatesIndexRouteModel) {
    super.setupController(controller, resolvedModel);
    const certificates = resolvedModel.certificates;

    if (certificates?.length) controller.notConfiguredMessage = getCliMessage('certificates');
    else controller.notConfiguredMessage = getCliMessage();
  }

  resetController(controller: RouteController, isExiting: boolean) {
    if (isExiting) {
      controller.set('page', undefined);
    }
  }
}
