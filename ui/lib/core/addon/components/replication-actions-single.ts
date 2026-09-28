/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@ember/component';

/**
 * @type Class
 *
 * Base class for the `replication-action-*` family of components
 * (replication-action-disable, -demote, -promote, -recover, -reindex,
 * -update-primary, -generate-token). `onSubmit` is injected by the caller
 * (see replication-actions.hbs's `{{component ... onSubmit=(action "onSubmit") ...}}`)
 * with an argument count that varies by concrete replication action, so it is
 * typed as a loose variadic passthrough rather than a fixed arity.
 *
 * `.extend()`-style subclassing is retained by every subclass because this
 * component keeps a classic `actions` hash — replication-action-disable's
 * template invokes it via the classic string-form `(action "onSubmit")`
 * helper, which requires a real `actions` hash on the prototype (resolved via
 * `send()`); flattening it into a same-named native class method would
 * collide with the `onSubmit` instance property assigned by the caller's
 * `{{component ... onSubmit=...}}` and silently break that forwarding at
 * runtime.
 */
export default class ReplicationActionsSingle extends Component {
  onSubmit(..._args: unknown[]): unknown {
    return undefined;
  }
  replicationMode: string | null = null;
  replicationModeForDisplay: string | null = null;
  model: unknown = null;

  actions = {
    onSubmit: (...args: unknown[]): unknown => {
      return this.onSubmit(...args);
    },
  };
}
