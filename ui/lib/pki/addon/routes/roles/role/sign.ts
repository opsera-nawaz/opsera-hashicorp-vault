/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import PkiCertificateForm from 'vault/forms/secrets/pki/certificate';

import type SecretMountPath from 'vault/services/secret-mount-path';
import type PkiRolesSignController from 'pki/controllers/roles/role/sign';

export interface RoleSignRouteModel {
  role: string;
  form: PkiCertificateForm;
}

export default class PkiRoleSignRoute extends Route {
  @service declare readonly secretMountPath: SecretMountPath;

  model(): RoleSignRouteModel {
    const { role } = this.paramsFor('roles/role') as { role: string };
    return {
      role,
      form: new PkiCertificateForm('PkiSignWithRoleRequest', {}, { isNew: true }),
    };
  }

  setupController(controller: PkiRolesSignController, resolvedModel: RoleSignRouteModel) {
    super.setupController(controller, resolvedModel);
    const { role } = this.paramsFor('roles/role') as { role: string };
    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: this.secretMountPath.currentPath, route: 'overview', model: this.secretMountPath.currentPath },
      { label: 'Roles', route: 'roles.index', model: this.secretMountPath.currentPath },
      { label: role, route: 'roles.role.details', models: [this.secretMountPath.currentPath, role] },
      { label: 'Sign Certificate' },
    ];
    // This is updated on successful generate in the controller
    controller.hasSubmitted = false;
  }
}
