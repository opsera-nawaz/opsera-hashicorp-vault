// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: BUSL-1.1

//go:build fips

package pki

// TestPKIBackend_FIPS (WO-054) extends the table-driven FIPS test pattern
// established by builtin/logical/ssh/backend_test.go's TestSSHBackend_CA_FIPS
// to the PKI engine, using in-process HandleRequest calls (via this
// package's CreateBackendWithStorage/CBWrite test helpers) rather than
// Docker containers -- PKI's FIPS surface is Vault-internal certificate/key
// generation, not external protocol negotiation.
//
// Unlike Transit (sdk/helper/keysutil), PKI's key/certificate generation
// (sdk/helper/certutil) has no isFIPSMode()/IsFIPSApproved() key-type gate
// today: certutil.GeneratePrivateKey supports "rsa", "ec", and "ed25519"
// unconditionally, and nothing in builtin/logical/pki calls into
// sdk/helper/keysutil's FIPS check. What PKI *does* already enforce
// (WO-028, FIPS-CRYPTO-002) is signature *hash* algorithm selection:
// selectSignatureAlgorithmForRSA/selectSignatureAlgorithmForECDSA
// (sdk/helper/certutil/helpers.go) only ever produce SHA-256/384/512
// variants, defaulting to SHA-256 for any unrecognized signature_bits
// value -- there is no way to make PKI sign with MD5 or SHA-1 through the
// public API. This file's cases are written against that real, verified
// behavior rather than asserting a key-type rejection that does not exist;
// see the Ed25519 case below and this story's edge_cases guidance ("PKI
// engine may not support Ed25519 key types for CA generation -- if not,
// the Ed25519 test case should be marked as N/A rather than expected-fail").

import (
	"crypto/x509"
	"testing"

	"github.com/stretchr/testify/require"
)

// pkiFIPSRootCACase is the PKI equivalent of TestSSHBackend_CA_FIPS's
// {name, caPublicKey, caPrivateKey, algoSigner, expectError} struct,
// specialized per this story's technical_details to
// {name, keyType, signatureAlgorithm, expectError} for root CA generation.
type pkiFIPSRootCACase struct {
	name    string
	keyType string
	keyBits int
	// approvedSignatureAlgorithms lists the FIPS-Approved x509.SignatureAlgorithm
	// values the self-signed root's algorithm must be one of.
	approvedSignatureAlgorithms []x509.SignatureAlgorithm
}

func TestPKIBackend_FIPS(t *testing.T) {
	t.Run("RootCAGeneration", func(t *testing.T) {
		// AC3(a)/(b): ECDSA P-256/P-384/P-521 and RSA-2048/3072/4096 root CA
		// generation succeeds, self-signed with a FIPS-Approved algorithm.
		testCases := []pkiFIPSRootCACase{
			{
				name:                        "ECDSA_P256_Approved",
				keyType:                     "ec",
				keyBits:                     256,
				approvedSignatureAlgorithms: []x509.SignatureAlgorithm{x509.ECDSAWithSHA256},
			},
			{
				name:                        "ECDSA_P384_Approved",
				keyType:                     "ec",
				keyBits:                     384,
				approvedSignatureAlgorithms: []x509.SignatureAlgorithm{x509.ECDSAWithSHA384},
			},
			{
				name:                        "ECDSA_P521_Approved",
				keyType:                     "ec",
				keyBits:                     521,
				approvedSignatureAlgorithms: []x509.SignatureAlgorithm{x509.ECDSAWithSHA512},
			},
			{
				name:                        "RSA2048_Approved",
				keyType:                     "rsa",
				keyBits:                     2048,
				approvedSignatureAlgorithms: []x509.SignatureAlgorithm{x509.SHA256WithRSA, x509.SHA384WithRSA, x509.SHA512WithRSA},
			},
			{
				name:                        "RSA3072_Approved",
				keyType:                     "rsa",
				keyBits:                     3072,
				approvedSignatureAlgorithms: []x509.SignatureAlgorithm{x509.SHA256WithRSA, x509.SHA384WithRSA, x509.SHA512WithRSA},
			},
			{
				name:                        "RSA4096_Approved",
				keyType:                     "rsa",
				keyBits:                     4096,
				approvedSignatureAlgorithms: []x509.SignatureAlgorithm{x509.SHA256WithRSA, x509.SHA384WithRSA, x509.SHA512WithRSA},
			},
		}

		for _, tc := range testCases {
			tc := tc
			t.Run(tc.name, func(t *testing.T) {
				testPKIBackend_FIPS_RootCAGeneration(t, tc)
			})
		}

		// Edge case: "PKI engine may not support Ed25519 key types for CA
		// generation -- if not, the Ed25519 test case should be marked as
		// N/A rather than expected-fail." PKI *does* support it, and does
		// not gate it, so this documents that real behavior instead of
		// asserting a rejection that does not exist in this codebase.
		t.Run("Ed25519_NotGatedByPKI_DocumentedBehavior", testPKIBackend_FIPS_Ed25519NotGated)
	})

	t.Run("CertificateIssuance", func(t *testing.T) {
		// AC3(c): certificate issuance with a SHA-256 (or stronger)
		// signature succeeds.
		t.Run("Issuance_UsesApprovedSignatureAlgorithm", testPKIBackend_FIPS_IssuanceUsesApprovedSignature)
		// AC3(d): "any attempt to use non-Approved signature algorithms is
		// rejected or defaults to Approved." PKI's signature_bits field
		// accepts an arbitrary int (fields.go) with no allow-list, so an
		// unrecognized/legacy value exercises certutil's default branch
		// rather than being rejected outright; either outcome satisfies
		// AC3(d), and this is what the code actually does.
		t.Run("UnrecognizedSignatureBits_DefaultsToApprovedSHA256", testPKIBackend_FIPS_UnrecognizedSignatureBitsDefaultsToApproved)
	})
}

func testPKIBackend_FIPS_RootCAGeneration(t *testing.T, tc pkiFIPSRootCACase) {
	b, s := CreateBackendWithStorage(t)

	resp, err := CBWrite(b, s, "root/generate/internal", map[string]interface{}{
		"common_name": "fips-root-" + tc.name + ".example.com",
		"key_type":    tc.keyType,
		"key_bits":    tc.keyBits,
	})
	require.NoError(t, err, "generating a %s root CA must succeed under FIPS mode: resp=%#v", tc.name, resp)
	require.NotNil(t, resp)

	certPEM, ok := resp.Data["certificate"].(string)
	require.True(t, ok && certPEM != "", "expected a certificate to be returned")

	cert := parseCert(t, certPEM)
	require.Contains(t, tc.approvedSignatureAlgorithms, cert.SignatureAlgorithm,
		"self-signed %s root CA must use a FIPS-Approved signature algorithm, got %s", tc.name, cert.SignatureAlgorithm)
}

func testPKIBackend_FIPS_Ed25519NotGated(t *testing.T) {
	b, s := CreateBackendWithStorage(t)

	resp, err := CBWrite(b, s, "root/generate/internal", map[string]interface{}{
		"common_name": "fips-ed25519-not-gated.example.com",
		"key_type":    "ed25519",
	})
	require.NoError(t, err,
		"PKI's certutil layer has no FIPS key-type gate (unlike Transit's sdk/helper/keysutil, WO-027/WO-043): "+
			"Ed25519 root CA generation succeeds today even under -tags fips; resp=%#v", resp)
	require.NotNil(t, resp)

	certPEM, ok := resp.Data["certificate"].(string)
	require.True(t, ok && certPEM != "")
	cert := parseCert(t, certPEM)
	require.Equal(t, x509.PureEd25519, cert.SignatureAlgorithm)
}

func testPKIBackend_FIPS_IssuanceUsesApprovedSignature(t *testing.T) {
	b, s := CreateBackendWithStorage(t)

	// No explicit CA "ttl": TestSystemView() (sdk/logical/testing.go) caps
	// MaxLeaseTTLVal at 48h, so the CA (and the role/issue ttl below) must
	// stay well under that ceiling rather than requesting a realistic
	// multi-year CA lifetime.
	_, err := CBWrite(b, s, "root/generate/internal", map[string]interface{}{
		"common_name": "fips-issuance-ca.example.com",
		"key_type":    "rsa",
		"key_bits":    2048,
	})
	require.NoError(t, err)

	_, err = CBWrite(b, s, "roles/fips-issuance-role", map[string]interface{}{
		"allowed_domains":  "example.com",
		"allow_subdomains": true,
		"key_type":         "rsa",
		"key_bits":         2048,
		"ttl":              "30m",
	})
	require.NoError(t, err)

	resp, err := CBWrite(b, s, "issue/fips-issuance-role", map[string]interface{}{
		"common_name": "leaf.example.com",
	})
	require.NoError(t, err)
	require.NotNil(t, resp)

	certPEM, ok := resp.Data["certificate"].(string)
	require.True(t, ok && certPEM != "")
	cert := parseCert(t, certPEM)
	require.Contains(t, []x509.SignatureAlgorithm{x509.SHA256WithRSA, x509.SHA384WithRSA, x509.SHA512WithRSA}, cert.SignatureAlgorithm,
		"issued leaf certificate must be signed with a FIPS-Approved RSA+SHA-2 algorithm, got %s", cert.SignatureAlgorithm)
}

func testPKIBackend_FIPS_UnrecognizedSignatureBitsDefaultsToApproved(t *testing.T) {
	b, s := CreateBackendWithStorage(t)

	// See testPKIBackend_FIPS_IssuanceUsesApprovedSignature for why these
	// ttls stay well under TestSystemView()'s 48h MaxLeaseTTLVal.
	_, err := CBWrite(b, s, "root/generate/internal", map[string]interface{}{
		"common_name": "fips-weak-sigbits-ca.example.com",
		"key_type":    "rsa",
		"key_bits":    2048,
	})
	require.NoError(t, err)

	_, err = CBWrite(b, s, "roles/fips-weak-sigbits-role", map[string]interface{}{
		"allowed_domains":  "example.com",
		"allow_subdomains": true,
		"key_type":         "rsa",
		"key_bits":         2048,
		"ttl":              "30m",
	})
	require.NoError(t, err)

	// signature_bits=1 does not correspond to any signature algorithm
	// (only 0/256/384/512 are meaningful); selectSignatureAlgorithmForRSA's
	// default branch must still pick SHA-256, never a weaker algorithm.
	resp, err := CBWrite(b, s, "issue/fips-weak-sigbits-role", map[string]interface{}{
		"common_name":    "leaf-weak.example.com",
		"signature_bits": 1,
	})
	require.NoError(t, err)
	require.NotNil(t, resp)

	certPEM, ok := resp.Data["certificate"].(string)
	require.True(t, ok && certPEM != "")
	cert := parseCert(t, certPEM)
	require.Equal(t, x509.SHA256WithRSA, cert.SignatureAlgorithm,
		"an unrecognized signature_bits value must default to the FIPS-Approved SHA-256 signature algorithm, not be honored as a weaker one")
}
