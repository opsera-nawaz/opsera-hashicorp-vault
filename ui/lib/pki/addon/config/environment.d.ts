/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

/**
 * Type declaration for the runtime module resolved by
 *    import config from './config/environment' (from lib/pki/addon/engine.ts)
 * This is the engine's auto-generated runtime config (populated from the
 * <meta name="pki/config/environment"> tag), not the build-time config function at
 * lib/pki/config/environment.js -- there is no on-disk .js file at this path for the
 * two to collide with; this declaration exists purely so tsc can resolve the import.
 */
declare const config: {
  modulePrefix: string;
  environment: string;
};

export default config;
