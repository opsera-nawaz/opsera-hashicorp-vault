/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

// 'ember-engines/engine' simply re-exports '@ember/engine'; importing the
// latter directly is Node/TS-resolvable (the former is an Ember-addon
// build-time-only virtual module path) and is the identical runtime value.
import Engine from '@ember/engine';
import loadInitializers from 'ember-load-initializers';
import Resolver from 'ember-resolver';
import config from './config/environment';

const { modulePrefix } = config;

interface LdapEngineDependencies {
  services: string[];
  externalRoutes: string[];
}

export default class LdapEngine extends Engine {
  modulePrefix: string = modulePrefix;
  Resolver: typeof Resolver = Resolver;
  dependencies: LdapEngineDependencies = {
    services: ['app-router', 'secret-mount-path', 'flash-messages', 'auth', 'api', 'capabilities'],
    externalRoutes: ['secrets', 'secretsGeneralSettingsConfiguration', 'vault'],
  };
}

loadInitializers(LdapEngine, modulePrefix);
