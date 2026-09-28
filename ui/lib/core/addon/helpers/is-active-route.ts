/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

/* eslint-disable ember/no-observers */
import { service } from '@ember/service';
import Helper from '@ember/component/helper';
import { observer } from '@ember/object';

import type RouterService from '@ember/routing/router-service';

const exact = (a: string | undefined, b: string): boolean => a === b;
const startsWith = (a: string | undefined, b: string): boolean => !!a && a.indexOf(b) === 0;

export default class IsActiveRouteHelper extends Helper {
  @service declare readonly router: RouterService;

  onRouteChange = observer(
    'router.currentURL',
    'router.currentRouteName',
    function (this: IsActiveRouteHelper) {
      this.recompute();
    }
  );

  compute([routeName, model]: [string | string[], unknown], { isExact }: { isExact?: boolean }): boolean {
    const router = this.router;
    const currentRoute = router.currentRouteName;
    let currentURL: string | undefined = router.currentURL ?? undefined;
    // if we have any query params we want to discard them
    currentURL = currentURL?.split('?')[0];
    const comparator = isExact ? exact : startsWith;
    if (!currentRoute) {
      return false;
    }
    if (Array.isArray(routeName)) {
      return routeName.some((name: string) => comparator(currentRoute, name));
    } else if (model) {
      // slice off the rootURL from the generated route
      return comparator(currentURL, router.urlFor(routeName, model).slice(router.rootURL.length - 1));
    } else {
      return comparator(currentRoute, routeName);
    }
  }
}
