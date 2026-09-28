/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { computed } from '@ember/object';
import Mixin from '@ember/object/mixin';
import escapeStringRegexp from 'escape-string-regexp';
import commonPrefix from 'core/utils/common-prefix';

interface ListControllerItem {
  id: string;
}

// Duck-typed shape of `this` for every method/computed below: the properties
// this mixin itself contributes, plus the EmberObject/Controller/Route APIs
// (`set`, `send`) it relies on from whatever host class it's composed onto
// (e.g. `Controller.extend(ListControllerMixin, {...})`). Mixin.create()'s
// own typing (`static create(...args: any[])`) doesn't propagate a usable
// `this` type into the object literal's methods, so it's supplied explicitly
// per-method via TypeScript's `this` parameter.
interface ListControllerMixinThis {
  filter: string;
  model: ListControllerItem[];
  filterMatchesKey: boolean;
  set(key: string, value: unknown): void;
  send(actionName: string): void;
}

export default Mixin.create({
  queryParams: {
    page: 'page',
    pageFilter: 'pageFilter',
  },

  page: 1,
  pageFilter: null,
  filter: null,
  filterFocused: false,

  isLoading: false,

  filterMatchesKey: computed('filter', 'model', 'model.[]', function (this: ListControllerMixinThis) {
    const { filter, model: content } = this;
    return !!(content.length && content.find((c) => c.id === filter));
  }),

  firstPartialMatch: computed(
    'filter',
    'model',
    'model.[]',
    'filterMatchesKey',
    function (this: ListControllerMixinThis) {
      const { filter, filterMatchesKey, model: content } = this;
      const re = new RegExp('^' + escapeStringRegexp(filter));
      const matchSet = content.filter((key) => re.test(key.id));
      const match = matchSet[0];

      if (filterMatchesKey || !match) {
        return null;
      }

      const sharedPrefix = commonPrefix(content as unknown as Record<string, string>[]);
      // if we already are filtering the prefix, then next we want
      // the exact match
      if (filter === sharedPrefix || matchSet.length === 1) {
        return match;
      }
      return { id: sharedPrefix };
    }
  ),

  actions: {
    setFilter(this: ListControllerMixinThis, val: string) {
      this.set('filter', val);
    },

    setFilterFocus(this: ListControllerMixinThis, bool: boolean) {
      this.set('filterFocused', bool);
    },
    refresh(this: ListControllerMixinThis) {
      // bubble to the list-route
      this.send('reload');
    },
  },
});
