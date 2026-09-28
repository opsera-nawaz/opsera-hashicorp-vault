/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Engine from 'ember-engines/engine';
import loadInitializers from 'ember-load-initializers';
import Resolver from 'ember-resolver';
import config from './config/environment';

const { modulePrefix } = config;

interface SyncEngineDependencies {
  services: string[];
  externalRoutes: string[];
}

export default class SyncEngine extends Engine {
  modulePrefix: string = modulePrefix;
  Resolver: typeof Resolver = Resolver;
  dependencies: SyncEngineDependencies = {
    services: [
      'flash-messages',
      'flags',
      'app-router',
      'store',
      'api',
      'capabilities',
      'version',
      '-portal',
      'permissions',
      'current-cluster',
      'namespace',
    ],
    externalRoutes: [
      'kvSecretOverview',
      'databaseStaticRoleOverview',
      'clientCountOverview',
      'vault',
      'secrets',
      'sync',
    ],
  };
}

loadInitializers(SyncEngine, modulePrefix);
