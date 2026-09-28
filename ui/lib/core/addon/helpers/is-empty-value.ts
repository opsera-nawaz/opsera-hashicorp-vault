/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { helper } from '@ember/component/helper';

export function isEmptyValue(value: unknown, hasDefault: unknown = false): boolean {
  if (hasDefault) {
    value = hasDefault;
  }
  if (typeof value === 'object' && value !== null) {
    return Object.keys(value).length === 0;
  }
  return value == null || value === '';
}

export default helper(function ([value]: [unknown], { hasDefault = false }: { hasDefault?: unknown }) {
  return isEmptyValue(value, hasDefault);
});
