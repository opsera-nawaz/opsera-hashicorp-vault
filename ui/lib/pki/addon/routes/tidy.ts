/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { withConfig } from 'pki/decorators/check-issuers';

import type ApiService from 'vault/services/api';
import type { PkiReadAutoTidyConfigurationResponse } from '@hashicorp/vault-client-typescript';
import type SecretsEngineResource from 'vault/resources/secrets/engine';
import type { WithConfig } from 'pki/decorators/check-issuers';

export interface TidyRouteModel {
  hasConfig: boolean;
  engine: SecretsEngineResource;
  autoTidyConfig: PkiReadAutoTidyConfigurationResponse;
}

@withConfig()
export default class PkiTidyRoute extends Route implements WithConfig {
  @service declare readonly api: ApiService;

  declare pkiMountHasConfig: boolean;

  async model(): Promise<TidyRouteModel> {
    const engine = this.modelFor('application') as SecretsEngineResource;
    const autoTidyConfig = await this.api.secrets.pkiReadAutoTidyConfiguration(engine.id);

    return {
      hasConfig: this.pkiMountHasConfig,
      engine,
      autoTidyConfig,
    };
  }
}
