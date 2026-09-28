/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { PKI_DEFAULT_EMPTY_STATE_MSG } from '../overview';
import timestamp from 'core/utils/timestamp';

import type Controller from '@ember/controller';
import type ApiService from 'vault/services/api';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type { PkiTidyStatusResponse } from '@hashicorp/vault-client-typescript';
import type { TidyRouteModel } from 'pki/routes/tidy';

export type TidyStatus = PkiTidyStatusResponse & { responseTimestamp: Date };

export interface TidyIndexRouteModel extends TidyRouteModel {
  tidyStatus: TidyStatus;
}

interface TidyIndexController extends Controller {
  notConfiguredMessage: string;
  tidyStatus: TidyStatus;
  fetchTidyStatus: () => Promise<TidyStatus>;
  pollTidyStatus: { perform(): void; cancelAll(): void };
}

export default class PkiTidyIndexRoute extends Route {
  @service declare readonly api: ApiService;
  @service declare readonly secretMountPath: SecretMountPath;

  async fetchTidyStatus(): Promise<TidyStatus> {
    const status = await this.api.secrets.pkiTidyStatus(this.secretMountPath.currentPath);
    return { ...status, responseTimestamp: timestamp.now() };
  }

  async model(): Promise<TidyIndexRouteModel> {
    const { hasConfig, autoTidyConfig, engine } = this.modelFor('tidy') as TidyRouteModel;
    const tidyStatus = await this.fetchTidyStatus();

    return {
      tidyStatus,
      hasConfig,
      autoTidyConfig,
      engine,
    };
  }

  setupController(controller: TidyIndexController, resolvedModel: TidyIndexRouteModel) {
    super.setupController(controller, resolvedModel);
    controller.notConfiguredMessage = PKI_DEFAULT_EMPTY_STATE_MSG;

    controller.tidyStatus = resolvedModel.tidyStatus;
    // NOTE: assigned unbound, matching pre-existing (pre-TS) behavior; `this` inside
    // fetchTidyStatus becomes the controller when invoked from pollTidyStatus below.
    // Preserved as-is here since fixing `this` binding is a behavior change out of scope
    // for this type-annotation-only conversion.
    controller.fetchTidyStatus = this.fetchTidyStatus;
    controller.pollTidyStatus.perform();
  }

  resetController(controller: TidyIndexController, isExiting: boolean) {
    if (isExiting) {
      controller.pollTidyStatus.cancelAll();
    }
  }
}
