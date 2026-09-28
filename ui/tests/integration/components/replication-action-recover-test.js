/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import sinon from 'sinon';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'vault/tests/helpers';
import { click, render } from '@ember/test-helpers';
import { hbs } from 'ember-cli-htmlbars';

// WO-034: replication-actions-single.ts is the highest-dependency wave 1
// foundation file (imported by 8 other core files, via the
// replication-action-{disable,demote,promote,recover,reindex,
// update-primary,generate-token} subclasses). It was converted from
// Component.extend({...}) to a native class, but its `actions` hash was
// deliberately kept (not flattened into a same-named class method) because
// the `onSubmit` instance property injected by callers
// (`{{component ... onSubmit=(action "onSubmit") ...}}`) would collide with
// a same-named prototype method. replication-action-recover.js has no
// override and its template calls `this.onSubmit` directly (target form,
// not the classic string-form `(action "onSubmit")` helper), making it a
// clean way to verify the base class's forwarding still round-trips through
// the real render/click pipeline.
module('Integration | Component | replication-action-recover', function (hooks) {
  setupRenderingTest(hooks);

  test('it renders with the expected elements', async function (assert) {
    await render(hbs`<ReplicationActionRecover />`);
    assert.dom('[data-test-recover-replication]').exists();
    assert.dom('[data-test-button="recover"]').hasText('Recover');
  });

  test('clicking through the confirm modal calls the externally-injected onSubmit with the base class instance property, not the class prototype default', async function (assert) {
    const onSubmit = sinon.spy();
    this.set('onSubmit', onSubmit);
    await render(hbs`<ReplicationActionRecover @onSubmit={{this.onSubmit}} />`);

    await click('[data-test-button="recover"]');
    await click('[data-test-confirm-button]');

    assert.true(onSubmit.calledOnceWith('recover'), 'forwards the click through to the injected @onSubmit');
  });
});
