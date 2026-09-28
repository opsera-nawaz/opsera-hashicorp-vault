/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { module, test } from 'qunit';
import { clusterStates, CLUSTER_STATES } from 'core/helpers/cluster-states';

// WO-034: clusterStates() is a wave 1 foundation file (imported by 3 other
// core files). Its typed signature (`[state]: [string]`) looks up a
// `keyof typeof CLUSTER_STATES` key with a runtime cast, since `state` is
// dynamic input from replication API responses and isn't guaranteed to be
// one of the known keys.
module('Unit | Helper | cluster-states', function () {
  test('it returns the matching entry for a known state', function (assert) {
    const result = clusterStates(['running']);
    assert.deepEqual(result, CLUSTER_STATES.running, 'returns the CLUSTER_STATES entry for a known key');
    assert.true(result.isOk, 'running is a healthy state');
    assert.false(result.isSyncing, 'running is not a syncing state');
  });

  test('it returns a default display for an unrecognized state', function (assert) {
    const result = clusterStates(['some-unknown-state']);
    assert.strictEqual(result.glyph, '', 'default glyph is an empty string');
    assert.strictEqual(result.isOk, null, 'default isOk is null');
    assert.strictEqual(result.isSyncing, null, 'default isSyncing is null');
  });

  test('it distinguishes syncing states from ok/error states', function (assert) {
    assert.true(clusterStates(['merkle-diff']).isSyncing, 'merkle-diff is syncing');
    assert.true(clusterStates(['connecting']).isSyncing, 'connecting is syncing');
    assert.false(clusterStates(['shutdown']).isOk, 'shutdown is not ok');
  });
});
