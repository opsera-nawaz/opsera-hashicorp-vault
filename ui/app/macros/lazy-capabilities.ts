/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

// usage:
//
// import lazyCapabilities, { apiPath } from 'vault/macros/lazy-capabilities';
//
// export default class SomeModel extends Model {
//   //pass the template string as the first arg, and be sure to use '' around the
//   //parameters that get interpolated in the string - that's how the template function
//   //knows where to put each value
//   @lazyCapabilities(apiPath`${'id'}/config/zeroaddress`, 'id') declare zeroAddressPath: CapabilitiesPathProxy;
// }

import { maybeQueryRecord } from 'vault/macros/maybe-query-record';

import type ObjectProxy from '@ember/object/proxy';
import type CapabilitiesModel from 'vault/models/capabilities';

/** Boolean capability flags looked up from a `capabilities` model, proxied via a lazily-fetched promise. */
export type CapabilitiesLookup = Pick<
  CapabilitiesModel,
  'canCreate' | 'canDelete' | 'canList' | 'canPatch' | 'canRead' | 'canSudo' | 'canUpdate'
>;

/** The lazily-resolved capabilities proxy a `@lazyCapabilities(...)`-decorated field is populated with. */
export type CapabilitiesPathProxy = ObjectProxy<CapabilitiesLookup>;

/** A template-literal tag that produces a function resolving `${'key'}` placeholders against a data hash. */
export function apiPath(strings: TemplateStringsArray, ...keys: string[]) {
  return function (data?: Record<string, unknown>): string {
    const dict = data || {};
    const result: unknown[] = [strings[0]];
    keys.forEach((key, i) => {
      result.push(dict[key], strings[i + 1]);
    });
    return result.join('');
  };
}

export default function lazyCapabilities(
  templateFn: (data?: Record<string, unknown>) => string,
  ...keys: string[]
) {
  return maybeQueryRecord(
    'capabilities',
    (context) => {
      // pull all context attrs
      const contextObject = context.getProperties(...keys);
      // remove empty ones
      const nonEmptyContexts = Object.keys(contextObject).reduce((ret: Record<string, unknown>, key) => {
        if (contextObject[key] != null) {
          ret[key] = contextObject[key];
        }
        return ret;
      }, {});
      // if all of them aren't present, cancel the fetch
      if (Object.keys(nonEmptyContexts).length !== keys.length) {
        return;
      }
      // otherwise proceed with the capabilities check
      return {
        id: templateFn(nonEmptyContexts),
      };
    },
    ...keys
  );
}
