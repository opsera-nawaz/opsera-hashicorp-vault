/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

// adapted from https://gist.github.com/jed/964849
const fn = (function (anchor: HTMLAnchorElement) {
  return function (url: string | null | undefined): Record<string, string> {
    // String(url) preserves the original implicit `anchor.href = null` -> "null"
    // string coercion now that the parameter is honestly typed as nullable
    anchor.href = String(url);
    const parts: Record<string, string> = {};
    for (const prop in anchor) {
      const value = anchor[prop as keyof HTMLAnchorElement];
      if ('' + value === value) {
        parts[prop] = value;
      }
    }

    return parts;
  };
})(document.createElement('a'));

export default fn;
