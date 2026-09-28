/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Actions from 'core/components/replication-actions-single';

export default Actions.extend({
  tagName: '',

  actions: {
    // `this` is explicitly typed against the base class (rather than left to
    // infer against this actions-hash object literal, which TS resolves to a
    // self-referential shape where `this.onSubmit` means "my 3-param sibling
    // below", not the base class's variadic onSubmit).
    onSubmit(this: Actions, replicationMode: string, clusterMode: string, evt: Event) {
      // No data is submitted for disable request
      return this.onSubmit(replicationMode, clusterMode, null, evt);
    },
  },
});
