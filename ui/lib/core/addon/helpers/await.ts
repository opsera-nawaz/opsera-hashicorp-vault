/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Helper from '@ember/component/helper';
import { Promise } from 'rsvp';

export default class AwaitHelper extends Helper {
  lastPromise: unknown = null;
  value: unknown = null;

  compute([promise]: [unknown]): unknown {
    if (!promise || typeof (promise as PromiseLike<unknown>).then !== 'function') {
      return promise;
    }
    if (promise !== this.lastPromise) {
      this.lastPromise = promise;
      this.value = null;
      this.resolve(promise);
    }
    return this.value;
  }

  // return type intentionally omitted: `Promise` here is rsvp's import
  // (shadowing the global), and an async method's declared return type must
  // be the global `Promise`, so it's left to inference instead.
  async resolve(promise: unknown) {
    let value: unknown;
    try {
      value = await Promise.resolve(promise);
    } catch (error) {
      value = error;
    } finally {
      // ensure this promise is still the newest promise
      // otherwise avoid firing recompute since a newer promise is in flight
      if (promise === this.lastPromise) {
        this.value = value;
        this.recompute();
      }
    }
  }
}
