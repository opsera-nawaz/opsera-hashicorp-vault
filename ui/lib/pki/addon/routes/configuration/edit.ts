/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import PkiConfigAcmeForm from 'vault/forms/secrets/pki/config/acme';
import PkiConfigClusterForm from 'vault/forms/secrets/pki/config/cluster';
import PkiConfigCrlForm from 'vault/forms/secrets/pki/config/crl';
import PkiConfigUrlsForm from 'vault/forms/secrets/pki/config/urls';

import type Controller from '@ember/controller';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type { Breadcrumb } from 'vault/app-types';
import type { ConfigurationRouteModel } from 'pki/routes/configuration';
import type SecretsEngineResource from 'vault/resources/secrets/engine';

export interface ConfigurationEditRouteModel {
  engine: SecretsEngineResource;
  capabilities: ConfigurationRouteModel['capabilities'];
  acmeForm: PkiConfigAcmeForm;
  clusterForm: PkiConfigClusterForm;
  urlsForm: PkiConfigUrlsForm;
  crlForm: PkiConfigCrlForm;
}

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
}

export default class PkiConfigurationEditRoute extends Route {
  @service declare readonly secretMountPath: SecretMountPath;

  model(): ConfigurationEditRouteModel {
    const { acme, cluster, urls, crl, engine, capabilities } = this.modelFor(
      'configuration'
    ) as ConfigurationRouteModel;
    return {
      engine,
      capabilities,
      acmeForm: new PkiConfigAcmeForm(acme as ConstructorParameters<typeof PkiConfigAcmeForm>[0]),
      clusterForm: new PkiConfigClusterForm(cluster as ConstructorParameters<typeof PkiConfigClusterForm>[0]),
      urlsForm: new PkiConfigUrlsForm(urls as ConstructorParameters<typeof PkiConfigUrlsForm>[0]),
      crlForm: new PkiConfigCrlForm(crl as ConstructorParameters<typeof PkiConfigCrlForm>[0]),
    };
  }

  setupController(controller: RouteController, resolvedModel: unknown) {
    super.setupController(controller, resolvedModel);
    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: this.secretMountPath.currentPath, route: 'overview', model: this.secretMountPath.currentPath },
      { label: 'Configuration', route: 'configuration.index', model: this.secretMountPath.currentPath },
      { label: 'Edit' },
    ];
  }
}
