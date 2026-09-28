/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Helper from '@ember/component/helper';
import { getOwner } from '@ember/owner';

interface RouterServiceLike {
  transitionTo(...args: unknown[]): unknown;
  transitionToExternal(...args: unknown[]): unknown;
}

/*
template helper that replaces ember-router-helpers https://github.com/rwjblue/ember-router-helpers
example:
<MyForm @onSave={{transition-to "vault.cluster.some.route.item" "item-id"}} />
<MyForm @onSave={{transition-to "vault.cluster.some.external.route"  external=true}} />
*/
export default class TransitionTo extends Helper {
  // We don't import the router service here because Ember Engine's use the alias 'app-router'
  // Since this helper is shared across engines, we look up the router dynamically using getOwner instead.
  // This way we avoid throwing an error by looking up a service that doesn't exist.
  // https://guides.emberjs.com/release/services/#toc_accessing-services
  get router(): RouterServiceLike {
    const owner = getOwner(this);
    return (owner?.lookup('service:router') ||
      owner?.lookup('service:app-router')) as unknown as RouterServiceLike;
  }

  compute(routeParams: unknown[], { external = false }: { external?: boolean }): () => unknown {
    if (external) {
      return () => this.router.transitionToExternal(...routeParams);
    }
    return () => this.router.transitionTo(...routeParams);
  }
}
