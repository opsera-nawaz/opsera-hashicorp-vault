/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Mixin from '@ember/object/mixin';

import type Transition from '@ember/routing/transition';
import type Controller from '@ember/controller';

interface ResolvedListModel {
  meta?: { currentPage?: number };
}

interface PaginationServiceLike {
  clearDataset(): void;
}

// See list-controller.ts's ListControllerMixinThis comment: Mixin.create()'s
// own typing doesn't propagate a usable `this` type into the object
// literal's methods, so the shape this mixin needs from its host Route is
// supplied explicitly per-method via TypeScript's `this` parameter.
interface ListRouteMixinThis {
  routeName: string;
  pagination: PaginationServiceLike;
  paramsFor(routeName: string): { pageFilter?: string };
  refresh(): unknown;
  _super(...args: unknown[]): unknown;
}

export default Mixin.create({
  queryParams: {
    page: {
      refreshModel: true,
    },
    pageFilter: {
      refreshModel: true,
    },
  },

  setupController(this: ListRouteMixinThis, controller: Controller, resolvedModel: ResolvedListModel) {
    const { pageFilter } = this.paramsFor(this.routeName);
    this._super(controller, resolvedModel);
    controller.setProperties({
      filter: pageFilter || '',
      page: resolvedModel?.meta?.currentPage || 1,
    });
  },

  resetController(this: ListRouteMixinThis, controller: Controller, isExiting: boolean) {
    this._super(controller, isExiting);
    if (isExiting) {
      controller.set('pageFilter', null);
      controller.set('filter', null);
    }
  },
  actions: {
    willTransition(this: ListRouteMixinThis, transition: Transition) {
      window.scrollTo(0, 0);
      if (transition.targetName !== this.routeName) {
        this.pagination.clearDataset();
      }
      return true;
    },
    reload(this: ListRouteMixinThis) {
      this.pagination.clearDataset();
      this.refresh();
    },
  },
});
