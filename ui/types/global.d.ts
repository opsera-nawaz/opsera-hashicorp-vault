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
