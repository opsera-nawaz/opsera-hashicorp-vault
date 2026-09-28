/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { SecretsApiPkiListIssuersListEnum } from '@hashicorp/vault-client-typescript';
import PkiRoleForm from 'vault/forms/secrets/pki/role';

import type Controller from '@ember/controller';
import type ApiService from 'vault/services/api';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type { Breadcrumb } from 'vault/app-types';

export type IssuerSelectOption = { issuer_name?: string; issuer_id: string };

export interface RolesCreateRouteModel {
  form: PkiRoleForm;
  issuers: IssuerSelectOption[];
}

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
}

export default class PkiRolesCreateRoute extends Route {
  @service declare readonly api: ApiService;
  @service declare readonly secretMountPath: SecretMountPath;

  async model(): Promise<RolesCreateRouteModel> {
    const backend = this.secretMountPath.currentPath;
    let issuers: IssuerSelectOption[] = [];
    try {
      const response = await this.api.secrets.pkiListIssuers(backend, SecretsApiPkiListIssuersListEnum.TRUE);
      issuers = this.api.keyInfoToArray<IssuerSelectOption>(response, 'issuer_id');
    } catch (error) {
      const { status } = await this.api.parseError(error);
      if (status !== 404) {
        throw error;
      }
    }
    return {
      form: new PkiRoleForm({}, { isNew: true }),
      issuers,
    };
  }

  setupController(controller: RouteController, resolvedModel: RolesCreateRouteModel) {
    super.setupController(controller, resolvedModel);
    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: this.secretMountPath.currentPath, route: 'overview', model: this.secretMountPath.currentPath },
      { label: 'Roles', route: 'roles.index', model: this.secretMountPath.currentPath },
      { label: 'Create' },
    ];
  }
}
