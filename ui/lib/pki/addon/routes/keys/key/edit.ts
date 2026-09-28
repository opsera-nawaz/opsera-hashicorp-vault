/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import PkiKeyForm from 'vault/forms/secrets/pki/key';

import type Controller from '@ember/controller';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type { Breadcrumb } from 'vault/app-types';
import type { KeyRouteModel } from 'pki/routes/keys/key';
import type { PkiKeyFormData } from 'vault/forms/secrets/pki/key';

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
}

export default class PkiKeyEditRoute extends Route {
  @service declare readonly secretMountPath: SecretMountPath;

  model(): PkiKeyForm {
    const { key } = this.modelFor('keys.key') as KeyRouteModel;
    return new PkiKeyForm(key as Partial<PkiKeyFormData>);
  }

  setupController(controller: RouteController, resolvedModel: PkiKeyForm) {
    super.setupController(controller, resolvedModel);
    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: this.secretMountPath.currentPath, route: 'overview', model: this.secretMountPath.currentPath },
      { label: 'Keys', route: 'keys.index', model: this.secretMountPath.currentPath },
      { label: resolvedModel.data.key_id ?? '' },
    ];
  }
}
