/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { module, test } from 'qunit';
import { setupTest } from 'ember-qunit';

module('Unit | Serializer | identity/group', function (hooks) {
  setupTest(hooks);

  test('it normalizes group key_info into an array of records keyed by id', function (assert) {
    // `group.ts` doesn't override `extractLazyPaginatedData` (unlike `entity.ts`), so list
    // normalization for groups goes through the `normalizeItems` it inherits from `_base.ts`.
    const serializer = this.owner.lookup('serializer:identity/group');
    const payload = {
      data: {
        keys: ['aaaa-group', 'bbbb-group'],
        key_info: {
          'aaaa-group': { name: 'group-one', type: 'internal', member_entity_ids: ['e1'] },
          'bbbb-group': { name: 'group-two', type: 'external', alias: { name: 'group-two-alias' } },
        },
      },
    };

    const result = serializer.normalizeItems(payload);

    assert.strictEqual(result.length, 2, 'returns one record per key');
    assert.strictEqual(result[0].id, 'aaaa-group', 'id is set from the key, not from key_info');
    assert.strictEqual(result[0].type, 'internal', 'type is preserved from key_info');
    assert.deepEqual(
      result[1].alias,
      { name: 'group-two-alias' },
      'embedded alias key_info is preserved for external groups'
    );
  });

  test('it strips an empty embedded alias before delegating to the base normalizeFindRecordResponse', function (assert) {
    const serializer = this.owner.lookup('serializer:identity/group');
    const store = this.owner.lookup('service:store');
    const modelClass = store.modelFor('identity/group');

    const payload = { id: 'ext-group', name: 'ext-group', type: 'external', alias: {} };
    serializer.normalizeFindRecordResponse(store, modelClass, payload, 'ext-group', 'findRecord');

    assert.notOk('alias' in payload, 'an empty embedded alias object is removed from the payload before normalization');
  });
});
