/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { kvErrorHandler } from 'kv/utils/kv-error-handler';

import type ApiService from 'vault/services/api';
import type Controller from '@ember/controller';
import type { KvSecretDataModel, KvSecretMetadata } from 'kv/utils/kv-types';
import type { SecretRouteModel } from '../secret';

export interface DetailsRouteModel extends SecretRouteModel {
  secret: KvSecretDataModel;
}

interface RouteController extends Controller {
  version?: string | number;
}

export default class KvSecretDetailsRoute extends Route {
  @service declare readonly api: ApiService;

  queryParams = {
    version: {
      refreshModel: true,
    },
  };

  async model(params: { version?: string }): Promise<DetailsRouteModel> {
    const parentModel = this.modelFor('secret') as SecretRouteModel;
    const { backend, path } = parentModel;
    let secret: KvSecretDataModel;
    // if a version is selected from the dropdown it triggers a model refresh
    // and we fire off new request for that version's secret data
    try {
      const { version } = params;
      const initOverride = version
        ? (context: Parameters<ApiService['addQueryParams']>[0]) =>
            this.api.addQueryParams(context, { version })
        : undefined;

      const { data, metadata } = await this.api.secrets.kvV2Read(path, backend, undefined, initOverride);
      secret = { secretData: data as Record<string, unknown> | undefined, ...(metadata as KvSecretMetadata) };
    } catch (error) {
      const { status, response } = await this.api.parseError(error);
      // the error body for a failed secret data read carries the same { data, metadata } envelope
      // as a successful kvV2Read (see kv-error-handler.ts's doc comment).
      const { data, metadata, failReadErrorCode } = kvErrorHandler(status, response) as {
        data?: Record<string, unknown>;
        metadata?: KvSecretMetadata;
        failReadErrorCode?: number;
      };
      secret = failReadErrorCode ? { failReadErrorCode } : { secretData: data, ...metadata };
    }

    return {
      ...parentModel,
      secret,
    };
  }

  // breadcrumbs are set in details/index.ts
  setupController(controller: RouteController, resolvedModel: DetailsRouteModel): void {
    super.setupController(controller, resolvedModel);
    const { version } = this.paramsFor(this.routeName) as { version?: string };
    controller.set('version', resolvedModel.secret.version || version);
  }

  resetController(controller: RouteController, isExiting: boolean): void {
    if (isExiting) {
      controller.set('version', undefined);
    }
  }
}
