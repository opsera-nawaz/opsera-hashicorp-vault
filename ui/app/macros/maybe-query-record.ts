/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { computed } from '@ember/object';
import ObjectProxy from '@ember/object/proxy';
import PromiseProxyMixin from '@ember/object/promise-proxy-mixin';
import { resolve } from 'rsvp';
import { buildWaiter } from '@ember/test-waiters';

/**
 * after upgrading to Ember 4.12 a secrets test was erroring with "Cannot create a new tag for `<model::capabilities:undefined>` after it has been destroyed"
 * see this GH issue for information on the fix https://github.com/emberjs/ember.js/issues/16541#issuecomment-382403523
 */
ObjectProxy.reopen({
  unknownProperty(key: string) {
    if (this.isDestroying || this.isDestroyed) {
      return;
    }

    // `content` is typed as the generic `object | undefined` on the un-parameterized
    // ObjectProxy this reopen() applies to; it is only ever a destroyable Ember object here.
    const content = this.content as { isDestroying?: boolean; isDestroyed?: boolean } | undefined;
    if (content && (content.isDestroying || content.isDestroyed)) {
      return;
    }

    return this._super(key);
  },
});

const waiter = buildWaiter('capabilities');

/** Minimal shape of the host record this macro is mixed onto: an ember-data model with a `store` service. */
export interface MaybeQueryRecordHost {
  store: {
    queryRecord: (modelName: string, query: Record<string, unknown>) => Promise<unknown>;
  };
  getProperties: (...keys: string[]) => Record<string, unknown>;
}

export type MaybeQueryRecordOptions =
  | Record<string, unknown>
  | ((context: MaybeQueryRecordHost) => Record<string, unknown> | undefined);

// `ObjectProxy.extend(PromiseProxyMixin)`'s DefinitelyTyped `.create()` signature does not merge in
// `PromiseProxyMixin`'s `promise` property from a single-mixin `.extend()` call (a known gap in the
// upstream types for this exact runtime-standard "promise proxy object" pattern), so the factory is
// asserted to the shape it is actually created with below.
interface PromiseObjectFactory {
  create(init: { promise: Promise<unknown> }): ObjectProxy;
}

export function maybeQueryRecord(
  modelName: string,
  options: MaybeQueryRecordOptions = {},
  ...keys: string[]
) {
  return computed(...keys, 'store', {
    get(this: MaybeQueryRecordHost) {
      const waiterToken = waiter.beginAsync();
      const query = typeof options === 'function' ? options(this) : options;
      const PromiseObject = ObjectProxy.extend(PromiseProxyMixin) as unknown as PromiseObjectFactory;

      return PromiseObject.create({
        promise: query
          ? this.store.queryRecord(modelName, query).finally(() => {
              waiter.endAsync(waiterToken);
            })
          : resolve({}).finally(() => {
              waiter.endAsync(waiterToken);
            }),
      });
    },
  });
}
