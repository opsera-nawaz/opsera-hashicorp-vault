/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import PkiTidyForm from 'vault/forms/secrets/pki/tidy';

import type Controller from '@ember/controller';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type { Breadcrumb } from 'vault/app-types';
import type { TidyRouteModel } from 'pki/routes/tidy';

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
}

export default class PkiTidyAutoConfigureRoute extends Route {
  @service declare readonly secretMountPath: SecretMountPath;

  model(): PkiTidyForm {
    const { autoTidyConfig } = this.modelFor('tidy') as TidyRouteModel;
    return new PkiTidyForm('PkiConfigureAutoTidyRequest', autoTidyConfig);
  }

  setupController(controller: RouteController, resolvedModel: PkiTidyForm) {
    // autoTidyConfig id is the backend path
    const { currentPath } = this.secretMountPath;
    super.setupController(controller, resolvedModel);
    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: currentPath, route: 'overview', model: currentPath },
      { label: 'Configuration', route: 'configuration.index', model: currentPath },
      { label: 'Tidy', route: 'tidy', model: currentPath },
      { label: 'Auto', route: 'tidy.auto', model: currentPath },
      { label: 'Configure' },
    ];
  }
}
