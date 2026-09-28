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
import type { IssuerSelectOption } from 'pki/routes/roles/create';

export interface RoleEditRouteModel {
  form: PkiRoleForm;
  issuers: IssuerSelectOption[];
}

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
}

export default class PkiRoleEditRoute extends Route {
  @service declare readonly api: ApiService;
  @service declare readonly secretMountPath: SecretMountPath;

  async model(): Promise<RoleEditRouteModel> {
    const { role: name } = this.paramsFor('roles/role') as { role: string };
    const backend = this.secretMountPath.currentPath;

    const role = await this.api.secrets.pkiReadRole(name, backend).then((role) => ({ name, ...role }));

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
      form: new PkiRoleForm(role),
      issuers,
    };
  }

  setupController(controller: RouteController, resolvedModel: RoleEditRouteModel) {
    super.setupController(controller, resolvedModel);
    const { form } = resolvedModel;
    const { name } = form.data;
    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: this.secretMountPath.currentPath, route: 'overview', model: this.secretMountPath.currentPath },
      { label: 'Roles', route: 'roles.index', model: this.secretMountPath.currentPath },
      { label: name, route: 'roles.role.details', models: [this.secretMountPath.currentPath, name as string] },
      { label: 'Edit' },
    ];
  }
}
