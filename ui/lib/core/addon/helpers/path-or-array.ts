/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { helper as buildHelper } from '@ember/component/helper';

export function pathOrArray([maybeArray, target]: [string | unknown[], Record<string, unknown>]): unknown {
  if (Array.isArray(maybeArray)) {
    return maybeArray;
  }
  return target[maybeArray];
}

export default buildHelper(pathOrArray);
