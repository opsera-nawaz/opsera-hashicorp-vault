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
// matrix, extended by WO-042 to also cover Encrypt() on ChaCha20-Poly1305
// keys (creation/rotation were already gated by WO-027; WO-042 adds the
// encrypt gate while leaving Decrypt() ungated for backward compatibility).
// The "FIPS mode off" half, IsFIPSApproved() itself, and the shared
// newExistingChaCha20Fixture/newExistingEd25519Fixture/
// preGeneratedChaCha20Ciphertext helpers live in policy_test.go (which
// compiles in both configurations).

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

// TestPolicy_FIPS_AllowsExistingChaCha20Decrypt covers AC2/AC8: a
// pre-existing chacha20-poly1305 ciphertext blob (as if written before
// FIPS mode was turned on, or produced by encrypt on a non-FIPS build)
// must still decrypt without error. The ciphertext is built via
// preGeneratedChaCha20Ciphertext rather than p.Encrypt -- as of WO-042,
// Encrypt on a ChaCha20-Poly1305 key is itself rejected under FIPS mode
// (see TestPolicy_FIPS_RejectsChaCha20Encrypt below), so it can no longer
// be used to produce the fixture ciphertext here.
func TestPolicy_FIPS_AllowsExistingChaCha20Decrypt(t *testing.T) {
	p := newExistingChaCha20Fixture(t)

	ct := preGeneratedChaCha20Ciphertext(t, p, []byte("pre-fips-plaintext"))

	pt, err := p.Decrypt(nil, nil, ct)
	require.NoError(t, err, "decrypting with a pre-existing chacha20-poly1305 key must succeed under FIPS mode")

	decoded, err := base64.StdEncoding.DecodeString(pt)
	require.NoError(t, err)
	require.Equal(t, []byte("pre-fips-plaintext"), decoded)
}

// TestPolicy_FIPS_RejectsChaCha20Encrypt covers AC1/AC5 (WO-042): encrypting
// new data with an existing chacha20-poly1305 key must fail under FIPS
// mode, with an error naming an Approved alternative. This is the
// complement of TestPolicy_FIPS_AllowsExistingChaCha20Decrypt above --
// together they prove the read-only backward-compatibility mode required
// by this story: old ciphertext keeps decrypting, but no new
// ChaCha20-Poly1305 encryption is permitted.
func TestPolicy_FIPS_RejectsChaCha20Encrypt(t *testing.T) {
	p := newExistingChaCha20Fixture(t)

	_, err := p.Encrypt(0, nil, nil, base64.StdEncoding.EncodeToString([]byte("new-plaintext")))
	require.Error(t, err)
	require.Contains(t, err.Error(), "not permitted for encryption in FIPS mode")
	require.Contains(t, err.Error(), "aes256-gcm96")
}

// TestPolicy_FIPS_RejectsConvergentChaCha20Encrypt covers the convergent-
// encryption edge case called out in WO-042: a chacha20-poly1305 key with
// convergent encryption enabled must also reject new encryption under FIPS
// mode, via the same gate (EncryptWithOptions checks the key type before
// branching into the convergent-vs-random-nonce logic).
func TestPolicy_FIPS_RejectsConvergentChaCha20Encrypt(t *testing.T) {
	p := newExistingChaCha20Fixture(t)
	p.ConvergentEncryption = true
	p.ConvergentVersion = 3

	_, err := p.Encrypt(0, nil, nil, base64.StdEncoding.EncodeToString([]byte("new-plaintext")))
	require.Error(t, err)
	require.Contains(t, err.Error(), "not permitted for encryption in FIPS mode")
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
