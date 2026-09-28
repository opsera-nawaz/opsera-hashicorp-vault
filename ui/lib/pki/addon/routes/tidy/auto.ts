/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';

import type { PkiReadAutoTidyConfigurationResponse } from '@hashicorp/vault-client-typescript';
import type { TidyRouteModel } from 'pki/routes/tidy';

export default class PkiTidyAutoRoute extends Route {
  model(): PkiReadAutoTidyConfigurationResponse {
    const { autoTidyConfig } = this.modelFor('tidy') as TidyRouteModel;
    return autoTidyConfig;
  }
}
