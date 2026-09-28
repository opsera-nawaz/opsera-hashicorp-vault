/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { SupportedSecretBackendsEnum } from 'vault/helpers/supported-secret-backends';

import type RouterService from '@ember/routing/router-service';
import type SecretsEngineResource from 'vault/resources/secrets/engine';

export default class PkiRoute extends Route {
  @service('app-router') declare readonly router: RouterService;

  redirect(model: SecretsEngineResource): void {
    if (model.type === SupportedSecretBackendsEnum.PKI_EXTERNAL) {
      this.router.transitionTo('vault.cluster.secrets.backend.pki.external.overview');
      return;
    }
    this.router.transitionTo('vault.cluster.secrets.backend.pki.overview');
  }
}
