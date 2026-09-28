/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { alias } from '@ember/object/computed';
import Component from '@ember/component';
import ReplicationActions from 'core/mixins/replication-actions';

const DEFAULTS = {
  token: null,
  primary_api_addr: null,
  primary_cluster_addr: null,
  errors: null,
  id: null,
  force: false,
};

// `Component.extend(ReplicationActions, DEFAULTS, {...})`'s resulting `this`
// inside these methods doesn't pick up either the base Component (isDestroyed,
// isDestroying, setProperties) or the composed mixin's own contributed
// properties (submitHandler) — Mixin.create()'s type is opaque outside of a
// generic parameter — so `this` is explicitly typed per-method instead. See
// mixins/replication-actions.ts's ReplicationActionsMixinThis comment.
interface ReplicationActionsThis {
  isDestroyed: boolean;
  isDestroying: boolean;
  setProperties(hash: Record<string, unknown>): void;
  reset(): void;
  submitHandler: { perform: (...args: unknown[]) => unknown };
}

export default Component.extend(ReplicationActions, DEFAULTS, {
  replicationMode: null,
  model: null,
  cluster: alias('model'),

  reset(this: ReplicationActionsThis) {
    if (!this || this.isDestroyed || this.isDestroying) {
      return;
    }
    this.setProperties(DEFAULTS);
  },

  actions: {
    onSubmit(this: ReplicationActionsThis, ...args: unknown[]) {
      return this.submitHandler.perform(...args);
    },
    clear(this: ReplicationActionsThis) {
      this.reset();
      this.setProperties({
        token: null,
        id: null,
      });
    },
  },
});
