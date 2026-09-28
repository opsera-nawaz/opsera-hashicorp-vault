/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { helper as buildHelper } from '@ember/component/helper';
import { capitalize } from 'vault/helpers/capitalize';
import { humanize } from 'vault/helpers/humanize';
import { dasherize } from 'vault/helpers/dasherize';

// Used both as a template helper (Ember passes the positional-args array
// as the first argument) and as a plain function by other core helpers
// (e.g. pki's tidy-field-label.ts calls `toLabel([field])` directly) — both
// callers already pass a [string] tuple, matching capitalize/humanize/
// dasherize's own [string] tuple argument convention.
export function toLabel([val]: [string]): string {
  return capitalize([humanize([dasherize([val])])]);
}

export default buildHelper(toLabel);
