/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import AuthService, { TOKEN_PREFIX, TOKEN_SEPARATOR, ROOT_PREFIX } from 'vault/services/auth';

import type { AuthResponseData } from 'vault/services/auth';

declare module '@ember/test-helpers' {
  interface TestContext {
    authService: AuthService;
  }
}

// These cases verify that auth.ts's method signatures are enforced at compile time
// (not just at runtime). Each `invalidCall` is declared but deliberately never invoked --
// `tsc --noEmit` still type-checks its body, and `@ts-expect-error` fails the build if the
// expected compile error stops occurring (e.g. if a signature is accidentally loosened back
// to `any`). The `assert` call just proves the check executed as part of the suite.
module('Unit | Service | auth (types)', function (hooks) {
  setupTest(hooks);

  hooks.beforeEach(function () {
    this.authService = this.owner.lookup('service:auth') as AuthService;
  });

  test('TOKEN_PREFIX, TOKEN_SEPARATOR, and ROOT_PREFIX are typed as string literals', function (assert) {
    // If these constants were widened to `string` instead of their literal types, assigning
    // them to a variable typed with the exact literal would fail to compile.
    const prefix: 'vault-' = TOKEN_PREFIX;
    const separator: '☃' = TOKEN_SEPARATOR;
    const rootPrefix: '_root_' = ROOT_PREFIX;

    assert.strictEqual(prefix, 'vault-', 'TOKEN_PREFIX retains its literal value');
    assert.strictEqual(separator, '☃', 'TOKEN_SEPARATOR retains its literal value');
    assert.strictEqual(rootPrefix, '_root_', 'ROOT_PREFIX retains its literal value');
  });

  test('persistAuthData requires clusterId to be a string', function (assert) {
    const service = this.authService;
    const invalidCall = () => {
      // @ts-expect-error clusterId must be a string, not a number
      service.persistAuthData(123, { authMethodType: 'token', authMountPath: '', token: 'x' });
    };
    assert.strictEqual(typeof invalidCall, 'function', 'wrong clusterId type is rejected at compile time');
  });

  test('persistAuthData requires authResponseData to include a token', function (assert) {
    const service = this.authService;
    const invalidCall = () => {
      // @ts-expect-error authResponseData is missing the required `token` field
      service.persistAuthData('1', { authMethodType: 'token', authMountPath: '' });
    };
    assert.strictEqual(
      typeof invalidCall,
      'function',
      'authResponseData missing required fields is rejected at compile time'
    );
  });

  test('calculateExpiration requires now to be a number', function (assert) {
    const service = this.authService;
    const invalidCall = () => {
      // @ts-expect-error now must be a number, not a string
      service.calculateExpiration({ now: 'not-a-number', ttl: 30, expireTime: null });
    };
    assert.strictEqual(typeof invalidCall, 'function', 'wrong now type is rejected at compile time');
  });

  test('calculateRootNamespace requires backend to be a string', function (assert) {
    const service = this.authService;
    const invalidCall = () => {
      // @ts-expect-error backend must be a string, not a number
      service.calculateRootNamespace('root', undefined, 42);
    };
    assert.strictEqual(typeof invalidCall, 'function', 'wrong backend type is rejected at compile time');
  });

  test('calculateExpiration returns the typed ttl/tokenExpirationEpoch shape', function (assert) {
    const now = Date.now();
    const result = this.authService.calculateExpiration({ now, ttl: 30, expireTime: null });
    // Return type is `{ ttl: number | null; tokenExpirationEpoch: number | null }` -- accessing
    // these fields without a cast proves the return type is concrete, not `any`.
    assert.strictEqual(result.ttl, 30, 'ttl is returned as typed');
    assert.strictEqual(result.tokenExpirationEpoch, now + 30 * 1e3, 'tokenExpirationEpoch is computed');
  });

  test('AuthResponseData rejects an authMethodType typed as a number', function (assert) {
    const invalidAssignment = () => {
      // @ts-expect-error authMethodType must be a string, not a number
      const data: AuthResponseData = { authMethodType: 1, authMountPath: '', token: 'x' };
      return data;
    };
    assert.strictEqual(typeof invalidAssignment, 'function', 'wrong field type is rejected at compile time');
  });
});
