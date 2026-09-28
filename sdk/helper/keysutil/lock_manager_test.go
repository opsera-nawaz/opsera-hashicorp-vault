// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: MPL-2.0

package keysutil

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"testing"

	"github.com/hashicorp/vault/sdk/logical"
	"github.com/stretchr/testify/require"
)

func TestImportPolicy(t *testing.T) {
	lm, err := NewLockManager(false, 0)
	require.NoError(t, err)

	ctx := context.Background()
	storage := &logical.InmemStorage{}

	testKeys, err := generateTestKeys()
	require.NoError(t, err)

	testCases := map[string]struct {
		req       PolicyRequest
		key       []byte
		expectErr bool
	}{
		"import AES key": {
			req: PolicyRequest{
				Name:         "test-aes-key",
				KeyType:      KeyType_AES256_GCM96,
				Storage:      storage,
				IsPrivateKey: true,
			},
			key: testKeys[KeyType_AES256_GCM96],
		},
		"import RSA key": {
			req: PolicyRequest{
				Name:         "test-rsa-key",
				KeyType:      KeyType_RSA2048,
				Storage:      storage,
				IsPrivateKey: true,
			},
			key: testKeys[KeyType_RSA2048],
		},
		"import ECDSA key": {
			req: PolicyRequest{
				Name:         "test-ecdsa-key",
				KeyType:      KeyType_ECDSA_P256,
				Storage:      storage,
				IsPrivateKey: true,
			},
			key: testKeys[KeyType_ECDSA_P256],
		},
		"import ED25519 key": {
			req: PolicyRequest{
				Name:         "test-ed25519-key",
				KeyType:      KeyType_ED25519,
				Storage:      storage,
				IsPrivateKey: true,
			},
			key: testKeys[KeyType_ED25519],
		},
		"import ed25519 with derivation": {
			req: PolicyRequest{
				Name:         "ed25519-derived",
				KeyType:      KeyType_ED25519,
				Storage:      storage,
				IsPrivateKey: true,
				Derived:      true,
			},
			key: testKeys[KeyType_ED25519],
		},
	}

	for name, tt := range testCases {
		t.Run(name, func(t *testing.T) {
			err = lm.ImportPolicy(ctx, tt.req, tt.key, rand.Reader)
			if tt.expectErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)

				pol, upserted, err := lm.GetPolicy(ctx, PolicyRequest{Name: tt.req.Name, Storage: storage}, rand.Reader)
				require.NoError(t, err)
				require.False(t, upserted)

				defer pol.Unlock()

				require.Equal(t, tt.req.KeyType, pol.Type)
				if tt.req.Derived {
					require.True(t, pol.Derived)
					require.Equal(t, Kdf_hkdf_sha256, pol.KDF)
				}
			}
		})
	}
}

// mockCryptoBarrier is a minimal in-memory stand-in that satisfies the
// CryptoBarrier interface (and, structurally, vault/interfaces.CryptoBarrier)
// for testing dependency injection into LockManager.
type mockCryptoBarrier struct {
	rotateCalls int
	store       map[string][]byte
}

func newMockCryptoBarrier() *mockCryptoBarrier {
	return &mockCryptoBarrier{store: make(map[string][]byte)}
}

func (m *mockCryptoBarrier) Encrypt(_ context.Context, key string, plaintext []byte) ([]byte, error) {
	ciphertext := append([]byte(nil), plaintext...)
	m.store[key] = ciphertext
	return ciphertext, nil
}

func (m *mockCryptoBarrier) Decrypt(_ context.Context, key string, ciphertext []byte) ([]byte, error) {
	stored, ok := m.store[key]
	if !ok {
		return nil, errors.New("mockCryptoBarrier: unknown key")
	}
	if !bytes.Equal(stored, ciphertext) {
		return nil, errors.New("mockCryptoBarrier: ciphertext mismatch")
	}
	return append([]byte(nil), stored...), nil
}

func (m *mockCryptoBarrier) RotateKey(_ context.Context) error {
	m.rotateCalls++
	return nil
}

func TestLockManager_WithCryptoBarrier(t *testing.T) {
	cb := newMockCryptoBarrier()

	lm, err := NewLockManager(false, 0, WithCryptoBarrier(cb))
	require.NoError(t, err)
	require.Same(t, cb, lm.cryptoBarrier)

	ctx := context.Background()
	ciphertext, err := lm.cryptoBarrier.Encrypt(ctx, "test-key", []byte("plaintext"))
	require.NoError(t, err)

	plaintext, err := lm.cryptoBarrier.Decrypt(ctx, "test-key", ciphertext)
	require.NoError(t, err)
	require.Equal(t, []byte("plaintext"), plaintext)

	require.NoError(t, lm.cryptoBarrier.RotateKey(ctx))
	require.Equal(t, 1, cb.rotateCalls)
}

func TestLockManager_WithoutCryptoBarrier(t *testing.T) {
	lm, err := NewLockManager(false, 0)
	require.NoError(t, err)
	require.Nil(t, lm.cryptoBarrier)
	require.Nil(t, lm.GetCryptoBarrier())

	// Existing, barrier-independent LockManager behavior must continue to
	// work identically when no CryptoBarrier is configured.
	ctx := context.Background()
	storage := &logical.InmemStorage{}
	_, upserted, err := lm.GetPolicy(ctx, PolicyRequest{
		Name:    "no-barrier-key",
		KeyType: KeyType_AES256_GCM96,
		Storage: storage,
		Upsert:  true,
	}, rand.Reader)
	require.NoError(t, err)
	require.True(t, upserted)
}

func TestLockManager_GetCryptoBarrier(t *testing.T) {
	cb := newMockCryptoBarrier()

	lmWith, err := NewLockManager(false, 0, WithCryptoBarrier(cb))
	require.NoError(t, err)
	require.Same(t, CryptoBarrier(cb), lmWith.GetCryptoBarrier())

	lmWithout, err := NewLockManager(false, 0)
	require.NoError(t, err)
	require.Nil(t, lmWithout.GetCryptoBarrier())
}

func TestRestorePolicy_NilPolicy(t *testing.T) {
	lm, err := NewLockManager(false, 0)
	require.NoError(t, err)

	ctx := context.Background()
	storage := &logical.InmemStorage{}

	// Create backup data without "policy" field (causes nil Policy)
	invalidBackup := base64.StdEncoding.EncodeToString([]byte(`{"archived_keys": null}`))

	_, err = lm.RestorePolicy(ctx, storage, "test-key", invalidBackup, false)
	require.Error(t, err)
	require.Contains(t, err.Error(), "backup data does not contain a valid policy")
}
