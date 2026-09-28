/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { SecretsApiPkiListIssuersListEnum } from '@hashicorp/vault-client-typescript';

import type ApiService from 'vault/services/api';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type Transition from '@ember/routing/transition';

/**
 * the overview, roles, issuers, certificates, and key routes all need to be aware of the whether there is a config for the engine
 * if the user has not configured they are prompted to do so in each of the routes
 * decorate the necessary routes to perform the check in the beforeModel hook since that may change what is returned for the model
 */

// TS requires mixin-factory base constructors to accept `any[]`, see TS's own mixin pattern docs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteConstructor = new (...args: any[]) => Route;

export interface WithConfig {
  pkiMountHasConfig: boolean;
}

export function withConfig() {
  return function decorator<T extends RouteConstructor>(SuperClass: T): T {
    if (!Object.prototype.isPrototypeOf.call(Route, SuperClass)) {
      // eslint-disable-next-line
      console.error(
        'withConfig decorator must be used on an instance of ember Route class. Decorator not applied to returned class'
      );
      return SuperClass;
    }
    class CheckConfig extends SuperClass implements WithConfig {
      @service declare readonly secretMountPath: SecretMountPath;
      @service declare readonly api: ApiService;

      pkiMountHasConfig = false;

      async beforeModel(transition: Transition): Promise<void> {
        await super.beforeModel(transition);

        // When the engine is configured, it creates a default issuer.
        // If the issuers list is empty, we know it hasn't been configured
        try {
          await this.api.secrets.pkiListIssuers(
            this.secretMountPath.currentPath,
            SecretsApiPkiListIssuersListEnum.TRUE
          );
          this.pkiMountHasConfig = true;
        } catch {
          this.pkiMountHasConfig = false;
        }
      }
    }
    return CheckConfig;
  };
}
