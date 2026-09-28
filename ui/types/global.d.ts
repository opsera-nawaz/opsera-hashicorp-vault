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
  function autosize(el: HTMLElement | HTMLElement[]): void;
  export default autosize;
}
