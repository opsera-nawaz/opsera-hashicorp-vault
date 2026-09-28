/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

/**
 * Type declarations for
 *    import config from './config/environment'
 * inside the kv engine. lib/kv/config/environment.js is a Node-only factory
 * consumed by Ember CLI's build; at runtime the `./config/environment`
 * specifier resolves to the object that factory returns, the same way
 * app/config/environment.d.ts stands in for the host app's build-time config.
 */
declare const config: {
  modulePrefix: string;
  environment: string;
};

export default config;
