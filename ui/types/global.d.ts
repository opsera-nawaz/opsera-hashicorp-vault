/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

// Types for compiled templates
declare module 'vault/templates/*' {
  import { TemplateFactory } from 'ember-cli-htmlbars';

  const tmpl: TemplateFactory;
  export default tmpl;
}

declare module '@icholy/duration' {
  import Duration from '@icholy/duration';
  export default Duration;
}

declare module 'vault/tests/helpers/vault-keys';

declare module '@carbon/charts/styles.css';

declare module 'sinon';

// uuid@9.0.1 ships no "types" field/declaration files in this repo's
// installed layout, and @types/uuid isn't a dependency.
declare module 'uuid';

// text-encoder-lite is loaded as a vendor global via `app.import()` in
// ember-cli-build.js (not an ES module), so it has no npm @types package.
declare class TextEncoderLite {
  constructor(encoding?: string);
  encode(input: string): Uint8Array;
}
declare class TextDecoderLite {
  constructor(encoding?: string);
  decode(input: Uint8Array): string;
}

// ember-cli-string-helpers merges these into the app's own `vault/helpers/*`
// namespace via Ember CLI's classic addon app-tree merging at build time, a
// mechanism `tsconfig.json`'s `paths` mapping (real files only) can't see.
declare module 'vault/helpers/capitalize' {
  export function capitalize(params: [string]): string;
  const helper: unknown;
  export default helper;
}
declare module 'vault/helpers/humanize' {
  export function humanize(params: [string]): string;
  const helper: unknown;
  export default helper;
}
declare module 'vault/helpers/dasherize' {
  export function dasherize(params: [string]): string;
  const helper: unknown;
  export default helper;
}

// autosize@6.0.1 ships no declaration files and @types/autosize doesn't exist.
declare module 'autosize' {
  function autosize(el: HTMLElement | HTMLElement[]): HTMLElement | HTMLElement[];
  namespace autosize {
    function update(el: HTMLElement | HTMLElement[]): HTMLElement | HTMLElement[];
    function destroy(el: HTMLElement | HTMLElement[]): HTMLElement | HTMLElement[];
  }
  export default autosize;
}

// jsondiffpatch and its HTML formatter are compiled into standalone UMD
// vendor bundles by webpack.jsondiffpatch.config.js and loaded as browser
// globals via `app.import()` in ember-cli-build.js (used by the KV engine's
// secret/version-diff views), so they have no import path of their own.
declare const jsondiffpatch: {
  create(options?: import('jsondiffpatch').Options): import('jsondiffpatch').DiffPatcher;
};
declare const htmlformatter: {
  format(delta: import('jsondiffpatch').Delta, left?: unknown): string | undefined;
};

// ember-engines exposes its addon/routes.js as the `ember-engines/routes` module through
// Ember CLI's addon build merging, not a real package export, so plain Node/TS module
// resolution can't see it and it ships no types of its own.
declare module 'ember-engines/routes' {
  export default function buildRoutes<T>(callback: T): T;
}
