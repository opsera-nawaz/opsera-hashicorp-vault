/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

// adapted from https://gist.github.com/jed/964849
const fn = (function (anchor: HTMLAnchorElement) {
  return function (url: string): Record<string, string> {
    anchor.href = url;
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
