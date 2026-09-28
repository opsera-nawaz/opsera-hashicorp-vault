// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: MPL-2.0

//go:build fips

package keysutil

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"testing"

	"github.com/hashicorp/vault/sdk/logical"
	"github.com/stretchr/testify/require"
)

// This file only compiles when the test binary is built with the fips
// build tag (`go test -tags fips ./...`), which makes isFIPSMode() (see
// fips_enabled.go) return true for real, rather than via a runtime mock of
// IsFIPS()/isFIPSMode(). It covers the "FIPS mode on" half of WO-027's test
// matrix; the "FIPS mode off" half, IsFIPSApproved() itself, and the shared
// newExistingChaCha20Fixture/newExistingEd25519Fixture helpers live in
// policy_test.go (which compiles in both configurations).

func TestPolicy_FIPS_ModeIsActive(t *testing.T) {
	require.True(t, isFIPSMode(), "this file must only run in a -tags fips build")
}

// TestPolicy_FIPS_RejectsNewChaCha20KeyCreation covers AC2: creating a new
// chacha20-poly1305 key while isFIPSMode() is true must fail before any key
// material is generated.
func TestPolicy_FIPS_RejectsNewChaCha20KeyCreation(t *testing.T) {
	lm, err := NewLockManager(true, 0)
	require.NoError(t, err)
	storage := &logical.InmemStorage{}

	p, upserted, err := lm.GetPolicy(context.Background(), PolicyRequest{
		Name:    "fips-new-chacha20",
		KeyType: KeyType_ChaCha20_Poly1305,
		Storage: storage,
		Upsert:  true,
	}, rand.Reader)
	require.Error(t, err)
	require.Contains(t, err.Error(), "not allowed in FIPS mode")
	require.False(t, upserted)
	require.Nil(t, p)
}

// TestPolicy_FIPS_RejectsNewEd25519KeyCreation covers AC2 for Ed25519.
func TestPolicy_FIPS_RejectsNewEd25519KeyCreation(t *testing.T) {
	lm, err := NewLockManager(true, 0)
	require.NoError(t, err)
	storage := &logical.InmemStorage{}

	p, upserted, err := lm.GetPolicy(context.Background(), PolicyRequest{
		Name:    "fips-new-ed25519",
		KeyType: KeyType_ED25519,
		Storage: storage,
		Upsert:  true,
	}, rand.Reader)
	require.Error(t, err)
	require.Contains(t, err.Error(), "not allowed in FIPS mode")
	require.False(t, upserted)
	require.Nil(t, p)
}

// TestPolicy_FIPS_AllowsExistingChaCha20Decrypt covers AC3: a
// pre-existing chacha20-poly1305 key (created before FIPS mode was turned
// on) must still decrypt without error.
func TestPolicy_FIPS_AllowsExistingChaCha20Decrypt(t *testing.T) {
	p := newExistingChaCha20Fixture(t)

	// Encrypt is not gated by this story (only creation and rotation are),
	// so it's used here purely to produce a valid ciphertext for the
	// pre-existing key to then decrypt.
	ct, err := p.Encrypt(0, nil, nil, base64.StdEncoding.EncodeToString([]byte("pre-fips-plaintext")))
	require.NoError(t, err)

	pt, err := p.Decrypt(nil, nil, ct)
	require.NoError(t, err, "decrypting with a pre-existing chacha20-poly1305 key must succeed under FIPS mode")

	decoded, err := base64.StdEncoding.DecodeString(pt)
	require.NoError(t, err)
	require.Equal(t, []byte("pre-fips-plaintext"), decoded)
}

// TestPolicy_FIPS_AllowsExistingEd25519Verify covers AC4: a pre-existing
// Ed25519 key (created before FIPS mode was turned on) must still verify
// signatures without error.
func TestPolicy_FIPS_AllowsExistingEd25519Verify(t *testing.T) {
	p := newExistingEd25519Fixture(t)

	sig, err := p.Sign(0, nil, []byte("pre-fips-message"), HashTypeNone, "", MarshalingTypeASN1)
	require.NoError(t, err)

	verified, err := p.VerifySignature(nil, []byte("pre-fips-message"), HashTypeNone, "", MarshalingTypeASN1, sig.Signature)
	require.NoError(t, err, "verifying with a pre-existing ed25519 key must succeed under FIPS mode")
	require.True(t, verified)
}

// TestPolicy_FIPS_RejectsChaCha20Rotation covers AC5: rotating an existing
// chacha20-poly1305 key must fail under FIPS mode, and must not create a
// new key version.
func TestPolicy_FIPS_RejectsChaCha20Rotation(t *testing.T) {
	p := newExistingChaCha20Fixture(t)

	err := p.RotateInMemory(rand.Reader)
	require.Error(t, err)
	require.Contains(t, err.Error(), "not allowed in FIPS mode")
	require.Equal(t, 1, p.LatestVersion, "rotation must not create a new key version when rejected")
	_, ok := p.Keys["2"]
	require.False(t, ok)
}

// TestPolicy_FIPS_RejectsEd25519Rotation covers AC5 for Ed25519.
func TestPolicy_FIPS_RejectsEd25519Rotation(t *testing.T) {
	p := newExistingEd25519Fixture(t)

	err := p.RotateInMemory(rand.Reader)
	require.Error(t, err)
	require.Contains(t, err.Error(), "not allowed in FIPS mode")
	require.Equal(t, 1, p.LatestVersion, "rotation must not create a new key version when rejected")
	_, ok := p.Keys["2"]
	require.False(t, ok)
}

// TestPolicy_FIPS_RejectsChaCha20Rotation_StructuredResponse covers WO-045:
// RotateInMemoryWithAlgorithm (the single physical FIPS enforcement point
// that both key creation and rotation flow through) must return a
// structured FIPSAlgorithmError response, not just a plain error string,
// when it rejects a non-Approved algorithm under FIPS mode. Called
// directly (rather than via RotateInMemory) because RotateInMemory only
// propagates the error half of the pair to its own callers.
func TestPolicy_FIPS_RejectsChaCha20Rotation_StructuredResponse(t *testing.T) {
	p := newExistingChaCha20Fixture(t)

	resp, err := p.RotateInMemoryWithAlgorithm(rand.Reader, KeyType_ChaCha20_Poly1305, nil)
	require.ErrorIs(t, err, logical.ErrInvalidRequest)
	require.NotNil(t, resp)
	require.True(t, resp.IsError(), "structured FIPS error response must still satisfy logical.Response.IsError()")

	data, ok := resp.Data["data"].(map[string]interface{})
	require.True(t, ok, "structured fields must be nested under Data[\"data\"]")
	require.Equal(t, "chacha20-poly1305", data["algorithm"])
	require.NotEmpty(t, data["fips_restriction"])
	require.Equal(t, "aes256-gcm96", data["recommended_alternative"])

	errText, ok := resp.Data["error"].(string)
	require.True(t, ok)
	require.Contains(t, errText, "chacha20-poly1305")
	require.Contains(t, errText, "aes256-gcm96")

	require.Equal(t, 1, p.LatestVersion, "rotation must not create a new key version when rejected")
	_, ok = p.Keys["2"]
	require.False(t, ok)
}

// TestPolicy_FIPS_RejectsEd25519Rotation_StructuredResponse covers WO-045
// for Ed25519; see TestPolicy_FIPS_RejectsChaCha20Rotation_StructuredResponse.
func TestPolicy_FIPS_RejectsEd25519Rotation_StructuredResponse(t *testing.T) {
	p := newExistingEd25519Fixture(t)

	resp, err := p.RotateInMemoryWithAlgorithm(rand.Reader, KeyType_ED25519, nil)
	require.ErrorIs(t, err, logical.ErrInvalidRequest)
	require.NotNil(t, resp)
	require.True(t, resp.IsError())

	data, ok := resp.Data["data"].(map[string]interface{})
	require.True(t, ok)
	require.Equal(t, "ed25519", data["algorithm"])
	require.NotEmpty(t, data["fips_restriction"])
	require.Equal(t, "ecdsa-p256, ecdsa-p384, or ecdsa-p521", data["recommended_alternative"])

	require.Equal(t, 1, p.LatestVersion)
	_, ok = p.Keys["2"]
	require.False(t, ok)
}
