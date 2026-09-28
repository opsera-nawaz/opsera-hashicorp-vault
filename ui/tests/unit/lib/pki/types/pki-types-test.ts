/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import { module, test } from 'qunit';
import { isApprovedKeyType, isApprovedSignatureAlgorithm } from 'pki/types/pki-types';

import type {
  PkiAcmeOrder,
  PkiCertificate,
  PkiIssuer,
  PkiKey,
  PkiKeyTypeInfo,
  PkiRole,
  PkiSignatureAlgorithmInfo,
} from 'pki/types/pki-types';

// These cases validate that the shared PKI type interfaces (pki-types.ts) represent
// certificate/key/role/ACME structures correctly, and that the FIPS-Approved-vs-not
// discrimination they add over the raw OpenAPI response types actually holds at both
// the type level (tsc catches misuse) and the runtime level (the narrowing helpers agree).
module('Unit | Lib | pki/types/pki-types', function () {
  test('PkiCertificate represents a complete, non-pending certificate', function (assert) {
    const cert: PkiCertificate = {
      serialNumber: '12:34:56',
      issuer: 'root-ca',
      subject: 'CN=example.com',
      notBefore: new Date('2026-01-01'),
      notAfter: new Date('2027-01-01'),
      signatureAlgorithm: 'SHA256WithRSA',
      keyUsage: ['DigitalSignature', 'KeyEncipherment'],
      extKeyUsage: ['ServerAuth'],
      subjectAltNames: [{ type: 'dns', value: 'example.com' }],
    };

    assert.strictEqual(cert.serialNumber, '12:34:56', 'serialNumber is set');
    assert.strictEqual(cert.subjectAltNames.length, 1, 'subjectAltNames holds SAN entries');
    assert.strictEqual(cert.subjectAltNames[0]?.type, 'dns', 'SAN entries carry a type');
  });

  test('PkiCertificate supports pending/incomplete certificates via optional validity fields', function (assert) {
    // Edge case: certificates for pending ACME orders or fresh CSRs have no validity window yet.
    const pendingCert: PkiCertificate = {
      serialNumber: '',
      issuer: '',
      subject: 'CN=pending.example.com',
      signatureAlgorithm: 'ECDSAWithSHA256',
      keyUsage: [],
      extKeyUsage: [],
      subjectAltNames: [],
    };

    assert.strictEqual(pendingCert.notBefore, undefined, 'notBefore is omittable');
    assert.strictEqual(pendingCert.notAfter, undefined, 'notAfter is omittable');
  });

  test('PkiCertificate supports multiple issuer chains for cross-signed certificates', function (assert) {
    // Edge case: cross-signed certs chain through more than one issuer path.
    const crossSigned: PkiCertificate = {
      serialNumber: 'ab:cd',
      issuer: 'intermediate-ca',
      subject: 'CN=cross-signed.example.com',
      signatureAlgorithm: 'SHA384WithRSA',
      keyUsage: [],
      extKeyUsage: [],
      subjectAltNames: [],
      issuerChains: [
        ['intermediate-ca', 'legacy-root-ca'],
        ['intermediate-ca', 'new-root-ca'],
      ],
    };

    assert.strictEqual(crossSigned.issuerChains?.length, 2, 'both issuer chains are represented');
    assert.strictEqual(crossSigned.issuerChains?.[1]?.[1], 'new-root-ca', 'chain order is preserved');
  });

  test('PkiIssuer represents a root issuer', function (assert) {
    const issuer: PkiIssuer = {
      issuerId: 'issuer-123',
      issuerName: 'root-2026',
      keyId: 'key-123',
      certificate: '-----BEGIN CERTIFICATE-----',
      caChain: ['-----BEGIN CERTIFICATE-----'],
      isRoot: true,
      isDefault: true,
    };

    assert.true(issuer.isRoot, 'isRoot is true for a root issuer');
    assert.strictEqual(issuer.caChain.length, 1, 'caChain holds the certificate chain');
  });

  test('PkiKey requires a keyType from the FIPS-relevant union', function (assert) {
    const rsaKey: PkiKey = { keyId: 'key-1', keyType: 'rsa', keyBits: 2048 };
    const ed25519Key: PkiKey = { keyId: 'key-2', keyType: 'ed25519' };

    assert.strictEqual(rsaKey.keyType, 'rsa', 'rsa is a valid keyType');
    assert.strictEqual(ed25519Key.keyType, 'ed25519', 'ed25519 remains representable for legacy keys');

    const invalidKeyType = () => {
      // @ts-expect-error 'dsa' is not part of the PkiKeyType union
      const badKey: PkiKey = { keyId: 'key-3', keyType: 'dsa' };
      return badKey;
    };
    assert.strictEqual(typeof invalidKeyType, 'function', 'an invalid keyType is rejected at compile time');
  });

  test('PkiRole represents a role referencing an issuer', function (assert) {
    const role: PkiRole = {
      name: 'example-dot-com',
      issuerRef: 'issuer-123',
      keyType: 'ec',
      ttl: 3600,
      maxTtl: 86400,
      allowedDomains: ['example.com'],
      noStore: false,
    };

    assert.strictEqual(role.name, 'example-dot-com', 'name is required');
    assert.strictEqual(role.allowedDomains?.[0], 'example.com', 'allowedDomains is a string array');
  });

  test('PkiAcmeOrder models the order lifecycle as a state machine union', function (assert) {
    // Edge case: ACME orders progress through new/submitted/.../completed/revoked/expired/error states.
    const pendingOrder: PkiAcmeOrder = {
      orderId: 'order-1',
      status: 'submitted',
      identifiers: ['example.com'],
    };
    const completedOrder: PkiAcmeOrder = {
      orderId: 'order-2',
      status: 'completed',
      identifiers: ['example.com'],
      certificate: '-----BEGIN CERTIFICATE-----',
    };

    assert.strictEqual(pendingOrder.status, 'submitted', 'orders start in a pending-like state');
    assert.strictEqual(completedOrder.status, 'completed', 'orders resolve to a terminal state');

    const invalidStatus = () => {
      // @ts-expect-error 'unknown-status' is not part of the OrderStatusName union
      const bad: PkiAcmeOrder = { orderId: 'order-3', status: 'unknown-status', identifiers: [] };
      return bad;
    };
    assert.strictEqual(typeof invalidStatus, 'function', 'an invalid status is rejected at compile time');
  });

  test('isApprovedSignatureAlgorithm distinguishes FIPS-Approved algorithms from legacy ones', function (assert) {
    assert.true(isApprovedSignatureAlgorithm('SHA256WithRSA'), 'SHA256WithRSA is Approved');
    assert.true(isApprovedSignatureAlgorithm('ECDSAWithSHA384'), 'ECDSAWithSHA384 is Approved');
    assert.false(isApprovedSignatureAlgorithm('ED25519'), 'ED25519 is not Approved');
    assert.false(isApprovedSignatureAlgorithm('SHA256WithRSAPSS'), 'RSA-PSS variants are not Approved');
  });

  test('isApprovedKeyType distinguishes FIPS-Approved key types from Ed25519', function (assert) {
    assert.true(isApprovedKeyType('rsa'), 'rsa is Approved');
    assert.true(isApprovedKeyType('ec'), 'ec is Approved');
    assert.false(isApprovedKeyType('ed25519'), 'ed25519 is not Approved');
  });

  test('PkiSignatureAlgorithmInfo and PkiKeyTypeInfo discriminated unions narrow on `approved`', function (assert) {
    const algoInfo: PkiSignatureAlgorithmInfo = isApprovedSignatureAlgorithm('SHA256WithRSA')
      ? { algorithm: 'SHA256WithRSA', approved: true }
      : { algorithm: 'ED25519', approved: false };
    const keyInfo: PkiKeyTypeInfo = isApprovedKeyType('ed25519')
      ? { keyType: 'rsa', approved: true }
      : { keyType: 'ed25519', approved: false };

    assert.true(algoInfo.approved, 'the Approved branch is selected for SHA256WithRSA');
    assert.false(keyInfo.approved, 'the non-Approved branch is selected for ed25519');
  });
});
