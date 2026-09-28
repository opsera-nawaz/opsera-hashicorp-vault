/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { module, test } from 'qunit';
import { setupRenderingTest } from 'vault/tests/helpers';
import { render } from '@ember/test-helpers';
import { hbs } from 'ember-cli-htmlbars';

// WO-034: external-link.ts is a wave 2 foundation file (imported by 2 other
// core files, including doc-link.ts). It was made generic
// (`ExternalLinkComponent<Args extends ExternalLinkArgs>`) so doc-link.ts's
// subclass, which adds its own `@path` arg on top of `@href`/`@sameTab`, can
// type `this.args` against its own narrower/extended Args interface instead
// of losing type information by extending a non-generic base class.
module('Integration | Component | external-link', function (hooks) {
  setupRenderingTest(hooks);

  test('it renders an external link that opens in a new tab by default', async function (assert) {
    await render(hbs`<ExternalLink @href="https://example.com">Arbitrary Link</ExternalLink>`);
    assert.dom('a').hasAttribute('href', 'https://example.com');
    assert.dom('a').hasAttribute('target', '_blank');
    assert.dom('a').hasAttribute('rel', 'noopener noreferrer');
    assert.dom('a').hasText('Arbitrary Link');
  });

  test('it renders in the same tab when @sameTab is true', async function (assert) {
    await render(hbs`<ExternalLink @href="https://example.com" @sameTab={{true}}>Link</ExternalLink>`);
    assert.dom('a').hasAttribute('href', 'https://example.com');
    assert.dom('a').doesNotHaveAttribute('target');
  });

  test('DocLink (a subclass with its own generic Args) computes href from @path against the fixed host', async function (assert) {
    await render(hbs`<DocLink @path="/vault/docs/secrets/kv/kv-v2.html">Learn about KV v2</DocLink>`);
    assert.dom('a').hasAttribute('href', 'https://developer.hashicorp.com/vault/docs/secrets/kv/kv-v2.html');
    assert.dom('a').hasText('Learn about KV v2');
  });
});
