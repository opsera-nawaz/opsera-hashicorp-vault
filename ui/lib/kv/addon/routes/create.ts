/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { breadcrumbsForSecret } from 'kv/utils/kv-breadcrumbs';
import KvForm from 'vault/forms/secrets/kv';

import type Controller from '@ember/controller';
import type { Breadcrumb } from 'vault/app-types';
import type SecretMountPath from 'vault/services/secret-mount-path';

interface RouteModel {
  backend: string;
  path: string | undefined;
  form: KvForm;
}

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
}

export default class KvSecretsCreateRoute extends Route {
  @service declare readonly secretMountPath: SecretMountPath;

  model(params: { initialKey?: string }): RouteModel {
    const backend = this.secretMountPath.currentPath;
    const { initialKey: path } = params;

    return {
      backend,
      path,
      form: new KvForm(
        {
          path,
          max_versions: 0,
          delete_version_after: '0s',
          cas_required: false,
          options: { cas: 0 },
        },
        { isNew: true }
      ),
    };
  }

  setupController(controller: RouteController, resolvedModel: RouteModel): void {
    super.setupController(controller, resolvedModel);

    const crumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: resolvedModel.backend, route: 'list', model: resolvedModel.backend },
      ...breadcrumbsForSecret(resolvedModel.backend, resolvedModel.path),
      { label: 'Create' },
    ];
    controller.breadcrumbs = crumbs;
  }
}
