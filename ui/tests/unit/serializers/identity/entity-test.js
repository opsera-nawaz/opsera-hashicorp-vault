/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { module, test } from 'qunit';
import { setupTest } from 'ember-qunit';

module('Unit | Serializer | identity/entity', function (hooks) {
  setupTest(hooks);

  test('it normalizes key_info into an array of entity records keyed by id', function (assert) {
    const serializer = this.owner.lookup('serializer:identity/entity');
    const payload = {
      data: {
        keys: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
        key_info: {
          '11111111-1111-1111-1111-111111111111': {
            name: 'entity-one',
            creation_time: '2026-01-01T00:00:00Z',
            metadata: { team: 'security' },
            aliases: [{ name: 'entity-one-alias', mount_type: 'userpass' }],
          },
          '22222222-2222-2222-2222-222222222222': {
            name: 'entity-two',
            creation_time: '2026-01-02T00:00:00Z',
            metadata: null,
            aliases: [],
          },
        },
      },
    };

    const result = serializer.extractLazyPaginatedData(payload);

    assert.strictEqual(result.length, 2, 'returns one record per key');
    assert.strictEqual(
      result[0].id,
      '11111111-1111-1111-1111-111111111111',
      'id is set from the key, not from key_info'
    );
    assert.strictEqual(result[0].name, 'entity-one', 'name is preserved from key_info');
    assert.deepEqual(result[0].metadata, { team: 'security' }, 'metadata object is preserved from key_info');
    assert.strictEqual(result[1].metadata, null, 'null metadata is preserved as-is');
  });

  test('it attaches the backend to each normalized record when present on the payload', function (assert) {
    const serializer = this.owner.lookup('serializer:identity/entity');
    const payload = {
      backend: 'userpass',
      data: {
        keys: ['33333333-3333-3333-3333-333333333333'],
        key_info: {
          '33333333-3333-3333-3333-333333333333': { name: 'entity-three' },
        },
      },
    };

    const [record] = serializer.extractLazyPaginatedData(payload);

    assert.strictEqual(record.backend, 'userpass', 'backend from the payload is attached to the record');
  });
});
