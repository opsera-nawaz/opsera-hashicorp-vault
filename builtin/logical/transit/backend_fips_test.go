// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: BUSL-1.1

//go:build fips

package transit

// TestTransitBackend_FIPS (WO-054) extends the table-driven FIPS test
// pattern established by builtin/logical/ssh/backend_test.go's
// TestSSHBackend_CA_FIPS to the Transit engine, exercising Approved-
// algorithm-only enforcement at the full API/HandleRequest layer (POST
// /transit/keys/:name, /encrypt/:name, /decrypt/:name, /sign/:name,
// /verify/:name) rather than by calling sdk/helper/keysutil's Policy
// methods directly. It is gated by the fips build tag (AC4), matching
// sdk/helper/keysutil/policy_fips_test.go's convention, rather than the
// runtime constants.IsFIPS() check used by path_encrypt_test.go and
// path_sign_verify_test.go -- this story asks for a dedicated,
// build-tag-gated test function (AC4/AC5), not another runtime-conditional
// case in an existing file.
//
// KNOWN LIMITATION (pre-existing, not introduced by this story): as
// documented on TestTransit_FIPS_ChaCha20Poly1305_EncryptRejectDecryptSucceed
// (path_encrypt_test.go) and TestTransit_SignVerify_ED25519_FIPS
// (path_sign_verify_test.go), github.com/hashicorp/vault/helper/constants
// has no fips-tagged implementation of IsFIPS() at the root module -- only
// the !fips one exists -- and three non-test files in this same package
// (path_datakey.go, path_encrypt.go, path_rewrap.go) call constants.IsFIPS()
// unconditionally. That means `go build/test -tags fips` does not currently
// compile ANY file in package transit, including this one, regardless of
// what this file itself contains. Wiring a real root-level FIPS build is
// tracked separately (see those two files' comments); the FIPS enforcement
// logic this file exercises (sdk/helper/keysutil's isFIPSMode()/
// IsFIPSApproved() gates from WO-027/WO-042/WO-043) is already proven
// passing under `go test -tags fips ./sdk/helper/keysutil/...`
// (policy_fips_test.go). This file was verified by temporarily neutralizing
// the three blocking constants.IsFIPS() call sites in a local, uncommitted
// working copy and confirming a clean compile and full pass; see this
// story's commit/comment for the exact commands and output.

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/hashicorp/vault/helper/constants"
	"github.com/hashicorp/vault/sdk/helper/keysutil"
	"github.com/hashicorp/vault/sdk/logical"
	"github.com/stretchr/testify/require"
)

// transitFIPSKeyCreationCase is the Transit equivalent of
// TestSSHBackend_CA_FIPS's {name, caPublicKey, caPrivateKey, algoSigner,
// expectError} struct: {name, keyType, operation, expectError}, specialized
// to the "operation" always being key creation for this table (backward-
// compatibility operations -- decrypt/verify/encrypt/sign against a
// pre-existing key -- are covered separately below, since they need a
// pre-seeded key rather than a type string).
type transitFIPSKeyCreationCase struct {
	name string
	// keyType is the API "type" string accepted by POST /transit/keys/:name.
	keyType string
	// keySize is only meaningful for keyType "hmac", which requires an
	// explicit key_size.
	keySize int
	// expectError and errorContains describe the FIPS-mode outcome for
	// *new* key creation.
	expectError   bool
	errorContains []string
	// entOnly marks a KeyType.IsEnterpriseOnly() key type (edge case:
	// "Enterprise-only key types (CMAC, ML_DSA, SLH_DSA) should be included
	// in the test matrix but may need to be skipped in Community/OSS
	// builds"). helper/constants.IsEnterprise is false in this build, so
	// the backend rejects creation with ErrKeyTypeEntOnly before the FIPS
	// gate is ever reached; the case instead asserts IsFIPSApproved()
	// directly against the keysutil.KeyType constant and skips the
	// HandleRequest half.
	entOnly    bool
	entKeyType keysutil.KeyType
}

func TestTransitBackend_FIPS(t *testing.T) {
	// AC1(a)-(e): AES-256-GCM96/ECDSA P-256/P-384/P-521/RSA-2048/3072/4096
	// creation succeeds; ChaCha20-Poly1305/Ed25519 creation fails with a
	// FIPS error. AES-128-GCM96 and HMAC are included too, extending
	// coverage to every non-Enterprise-only KeyType per this story's
	// implementation_steps. AC5: named, table-driven cases make it trivial
	// to add new algorithm combinations here.
	testCases := []transitFIPSKeyCreationCase{
		{name: "AES128GCM96_Approved", keyType: "aes128-gcm96"},
		{name: "AES256GCM96_Approved", keyType: "aes256-gcm96"},
		{
			name:          "ChaCha20Poly1305_Rejected",
			keyType:       "chacha20-poly1305",
			expectError:   true,
			errorContains: []string{"not allowed in FIPS mode", "chacha20-poly1305", "aes256-gcm96"},
		},
		{name: "ECDSA_P256_Approved", keyType: "ecdsa-p256"},
		{name: "ECDSA_P384_Approved", keyType: "ecdsa-p384"},
		{name: "ECDSA_P521_Approved", keyType: "ecdsa-p521"},
		{
			name:          "Ed25519_Rejected",
			keyType:       "ed25519",
			expectError:   true,
			errorContains: []string{"not allowed in FIPS mode", "ed25519", "ecdsa-p256"},
		},
		{name: "RSA2048_Approved", keyType: "rsa-2048"},
		{name: "RSA3072_Approved", keyType: "rsa-3072"},
		{name: "RSA4096_Approved", keyType: "rsa-4096"},
		{name: "HMAC_Approved", keyType: "hmac", keySize: 32},
		{name: "AES128CMAC_EnterpriseOnly_StillFIPSApproved", keyType: "aes128-cmac", entOnly: true, entKeyType: keysutil.KeyType_AES128_CMAC},
		{name: "AES192CMAC_EnterpriseOnly_StillFIPSApproved", keyType: "aes192-cmac", entOnly: true, entKeyType: keysutil.KeyType_AES192_CMAC},
		{name: "AES256CMAC_EnterpriseOnly_StillFIPSApproved", keyType: "aes256-cmac", entOnly: true, entKeyType: keysutil.KeyType_AES256_CMAC},
	}

	t.Run("KeyCreation", func(t *testing.T) {
		for _, tc := range testCases {
			tc := tc
			t.Run(tc.name, func(t *testing.T) {
				testTransitBackend_FIPS_KeyCreation(t, tc)
			})
		}
	})

	// AC2: backward compatibility for pre-existing non-Approved keys --
	// decrypt/verify of data produced before FIPS mode was enabled must
	// keep working, while encrypt/sign of *new* data with the same key must
	// not.
	t.Run("BackwardCompatibility", func(t *testing.T) {
		t.Run("ChaCha20Poly1305_ExistingKey_DecryptSucceedsEncryptFails", testTransitBackend_FIPS_ChaCha20BackwardCompat)
		t.Run("Ed25519_ExistingKey_VerifySucceedsSignFails", testTransitBackend_FIPS_Ed25519BackwardCompat)
	})

	// Edge case: "Transit engine's managed key type (KeyType_MANAGED_KEY)
	// delegates to external KMS -- the FIPS test should verify it is
	// treated as approved since the KMS handles algorithm selection."
	// KeyType_MANAGED_KEY is also Enterprise-only (IsEnterpriseOnly()) and
	// requires a configured external KMS this unit test has no way to wire
	// up, so this asserts the FIPS-approval predicate directly rather than
	// exercising it via HandleRequest.
	t.Run("ManagedKey_TreatedAsApproved", func(t *testing.T) {
		require.True(t, keysutil.KeyType(keysutil.KeyType_MANAGED_KEY).IsFIPSApproved(),
			"managed keys delegate algorithm selection to an external, independently-validated KMS, so they must be treated as FIPS-Approved")
	})
}

func testTransitBackend_FIPS_KeyCreation(t *testing.T, tc transitFIPSKeyCreationCase) {
	if tc.entOnly {
		require.True(t, tc.entKeyType.IsFIPSApproved(),
			"%s is FIPS-Approved (SP 800-38B AES-CMAC) even though this Community/OSS build cannot create one", tc.keyType)
		if !constants.IsEnterprise {
			t.Skipf("%s is Enterprise-only (KeyType.IsEnterpriseOnly()); creation is rejected by the Enterprise-only gate before the FIPS gate is ever reached in this Community/OSS build", tc.keyType)
		}
	}

	b, storage := createBackendWithStorage(t)

	data := map[string]interface{}{"type": tc.keyType}
	if tc.keyType == "hmac" {
		data["key_size"] = tc.keySize
	}

	req := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "keys/fips-" + tc.keyType,
		Storage:   storage,
		Data:      data,
	}
	resp, err := b.HandleRequest(context.Background(), req)

	if tc.expectError {
		require.Error(t, err, "creating a %s key must be rejected under FIPS mode", tc.keyType)
		for _, substr := range tc.errorContains {
			require.Contains(t, err.Error(), substr)
		}
		require.True(t, resp == nil || resp.IsError())
		return
	}

	require.NoError(t, err, "creating a %s key must succeed under FIPS mode: resp=%#v", tc.keyType, resp)
	require.NotNil(t, resp)
	require.False(t, resp.IsError())
}

// testTransitBackend_FIPS_ChaCha20BackwardCompat seeds storage with a
// keysutil.Policy for a chacha20-poly1305 key -- constructed directly and
// persisted via the exported Policy.Persist, bypassing the gated
// create/rotate path -- to simulate a key that existed before this binary
// was built with the fips tag. The pre-existing ciphertext is likewise
// built from the exported, ungated Policy.SymmetricEncryptRaw primitive
// rather than EncryptWithOptions/Encrypt (which WO-042 gates), mirroring
// sdk/helper/keysutil/policy_test.go's preGeneratedChaCha20Ciphertext. Both
// halves are then driven through the real Transit HandleRequest path
// (decrypt/:name, encrypt/:name), per this story's "in-process
// HandleRequest calls" constraint.
func testTransitBackend_FIPS_ChaCha20BackwardCompat(t *testing.T) {
	b, storage := createBackendWithStorage(t)
	const keyName = "existing-chacha20"

	rawKey := make([]byte, 32)
	_, err := rand.Read(rawKey)
	require.NoError(t, err)
	hmacKey := make([]byte, 32)
	_, err = rand.Read(hmacKey)
	require.NoError(t, err)

	algo := keysutil.KeyType(keysutil.KeyType_ChaCha20_Poly1305)
	p := &keysutil.Policy{
		Name:                 keyName,
		Type:                 keysutil.KeyType_ChaCha20_Poly1305,
		LatestVersion:        1,
		MinDecryptionVersion: 1,
		Keys: map[string]keysutil.KeyEntry{
			"1": {
				Key:       rawKey,
				HMACKey:   hmacKey,
				Algorithm: &algo,
			},
		},
	}
	require.NoError(t, p.Persist(context.Background(), storage), "failed to seed pre-existing chacha20-poly1305 policy")

	plaintext := []byte("pre-fips-plaintext")
	rawCiphertext, err := p.SymmetricEncryptRaw(1, rawKey, plaintext, keysutil.SymmetricOpts{HMACKey: hmacKey})
	require.NoError(t, err)
	versionPrefix := strings.Replace(keysutil.DefaultVersionTemplate, "{{version}}", "1", 1)
	wireCiphertext := versionPrefix + base64.StdEncoding.EncodeToString(rawCiphertext)

	// AC2: decrypting existing chacha20-poly1305 ciphertext must succeed
	// under FIPS mode.
	decryptResp, err := b.HandleRequest(context.Background(), &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "decrypt/" + keyName,
		Storage:   storage,
		Data:      map[string]interface{}{"ciphertext": wireCiphertext},
	})
	require.NoError(t, err, "decrypting a pre-existing chacha20-poly1305 ciphertext must succeed under FIPS mode")
	require.NotNil(t, decryptResp)
	require.False(t, decryptResp.IsError())
	decoded, err := base64.StdEncoding.DecodeString(decryptResp.Data["plaintext"].(string))
	require.NoError(t, err)
	require.Equal(t, plaintext, decoded)

	// AC1(d): new encryption with this same (now-existing) chacha20-poly1305
	// key must be rejected under FIPS mode.
	encryptResp, err := b.HandleRequest(context.Background(), &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "encrypt/" + keyName,
		Storage:   storage,
		Data:      map[string]interface{}{"plaintext": base64.StdEncoding.EncodeToString([]byte("new-fips-plaintext"))},
	})
	require.Error(t, err, "encrypting new data with an existing chacha20-poly1305 key must be rejected under FIPS mode")
	require.True(t, encryptResp == nil || encryptResp.IsError())
	errMsg := err.Error()
	if encryptResp != nil {
		if respErr, ok := encryptResp.Data["error"].(string); ok && respErr != "" {
			errMsg = respErr
		}
	}
	require.Contains(t, errMsg, "not permitted for encryption in FIPS mode")
	require.Contains(t, errMsg, "aes256-gcm96")
}

// testTransitBackend_FIPS_Ed25519BackwardCompat is the Ed25519 counterpart
// of testTransitBackend_FIPS_ChaCha20BackwardCompat: it seeds a pre-existing
// ed25519 key/signature the same way (direct Policy construction + Persist,
// raw stdlib ed25519.Sign instead of the gated Policy.Sign), then proves
// verify keeps working while sign is rejected, via the real
// verify/:name and sign/:name HandleRequest paths. This complements (does
// not duplicate) TestTransit_SignVerify_ED25519_FIPS in
// path_sign_verify_test.go, which asserts the same enforcement at the HTTP
// layer using the runtime constants.IsFIPS() pattern; this one is the
// build-tag-gated, table-driven case AC2/AC4 of this story ask for.
func testTransitBackend_FIPS_Ed25519BackwardCompat(t *testing.T) {
	b, storage := createBackendWithStorage(t)
	const keyName = "existing-ed25519"

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)

	algo := keysutil.KeyType(keysutil.KeyType_ED25519)
	p := &keysutil.Policy{
		Name:                 keyName,
		Type:                 keysutil.KeyType_ED25519,
		LatestVersion:        1,
		MinDecryptionVersion: 1,
		Keys: map[string]keysutil.KeyEntry{
			"1": {
				Key:                priv,
				FormattedPublicKey: base64.StdEncoding.EncodeToString(pub),
				Algorithm:          &algo,
			},
		},
	}
	require.NoError(t, p.Persist(context.Background(), storage), "failed to seed pre-existing ed25519 policy")

	message := []byte("pre-fips-message")
	input := base64.StdEncoding.EncodeToString(message)
	rawSig := ed25519.Sign(priv, message)
	versionPrefix := strings.Replace(keysutil.DefaultVersionTemplate, "{{version}}", "1", 1)
	wireSig := versionPrefix + base64.StdEncoding.EncodeToString(rawSig)

	// AC2: verifying a signature produced by this pre-existing Ed25519 key
	// must succeed under FIPS mode.
	verifyResp, err := b.HandleRequest(context.Background(), &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "verify/" + keyName,
		Storage:   storage,
		Data:      map[string]interface{}{"input": input, "signature": wireSig},
	})
	require.NoError(t, err, "verifying a pre-existing ed25519 signature must succeed under FIPS mode")
	require.NotNil(t, verifyResp)
	require.False(t, verifyResp.IsError())
	require.True(t, verifyResp.Data["valid"].(bool))

	// AC1(e): signing new data with this same (now-existing) Ed25519 key
	// must be rejected under FIPS mode.
	signResp, err := b.HandleRequest(context.Background(), &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "sign/" + keyName,
		Storage:   storage,
		Data:      map[string]interface{}{"input": input},
	})
	require.Error(t, err, "signing with an existing ed25519 key must be rejected under FIPS mode")
	require.True(t, signResp == nil || signResp.IsError())
	require.Contains(t, err.Error(), "not allowed in FIPS mode")
	require.Contains(t, err.Error(), "ed25519")
	require.Contains(t, err.Error(), "ecdsa-p256")
}
