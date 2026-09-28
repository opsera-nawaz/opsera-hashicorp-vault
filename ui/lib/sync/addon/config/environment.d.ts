/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

/**
 * Type declarations for the config built by ../config/environment.js and
 * consumed via `import config from './config/environment'` inside this
 * engine's addon tree. Ember CLI merges the built config into the
 * `sync/config/environment` module at build time; this file exists purely
 * to give that runtime module a compile-time shape and has no output.
 */
declare const config: {
  modulePrefix: string;
  environment: string;
};

export default config;
