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
import type { PkiReadRoleResponse } from '@hashicorp/vault-client-typescript';
import type { Breadcrumb } from 'vault/app-types';

export type RoleWithName = PkiReadRoleResponse & { name: string };

interface RoleCapabilities {
  canEdit: boolean | undefined;
  canDelete: boolean | undefined;
  canGenerateCert: boolean | undefined;
  canSign: boolean | undefined;
}

export interface RoleDetailsRouteModel {
  role: RoleWithName;
  capabilities: RoleCapabilities;
}

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
}

export default class RolesRoleDetailsRoute extends Route {
  @service declare readonly api: ApiService;
  @service declare readonly secretMountPath: SecretMountPath;
  @service declare readonly capabilities: CapabilitiesService;

  async fetchCapabilities(id: string): Promise<RoleCapabilities> {
    const { pathFor } = this.capabilities;
    const backend = this.secretMountPath.currentPath;

    const pathMap = {
      role: pathFor('pkiRole', { backend, id }),
      issue: pathFor('pkiIssue', { backend, id }),
      sign: pathFor('pkiSign', { backend, id }),
    };
    const perms = await this.capabilities.fetch(Object.values(pathMap));

    return {
      canEdit: perms[pathMap.role]?.canUpdate,
      canDelete: perms[pathMap.role]?.canDelete,
      canGenerateCert: perms[pathMap.issue]?.canUpdate,
      canSign: perms[pathMap.sign]?.canUpdate,
    };
  }

  async model(): Promise<RoleDetailsRouteModel> {
    const { role: name } = this.paramsFor('roles/role') as { role: string };
    return {
      role: await this.api.secrets
        .pkiReadRole(name, this.secretMountPath.currentPath)
        .then((role) => ({ name, ...role })),
      capabilities: await this.fetchCapabilities(name),
    };
  }

  setupController(controller: RouteController, resolvedModel: RoleDetailsRouteModel) {
    super.setupController(controller, resolvedModel);
    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: this.secretMountPath.currentPath, route: 'overview', model: this.secretMountPath.currentPath },
      { label: 'Roles', route: 'roles.index', model: this.secretMountPath.currentPath },
      { label: resolvedModel.role.name },
    ];
  }
}
