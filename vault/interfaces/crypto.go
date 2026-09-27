// Copyright IBM Corp. 2026
// SPDX-License-Identifier: BUSL-1.1

package interfaces

import "context"

// CryptoBarrier is the minimal encrypt/decrypt/rotate contract that
// storage-encryption consumers (e.g. sdk/helper/keysutil,
// vault/barrier_aes_gcm) depend on instead of a concrete barrier type.
//
// Encrypt and Decrypt are modeled directly on vault/barrier_access.go's
// BarrierEncryptor interface, so any existing BarrierEncryptor
// implementation (e.g. vault.BarrierEncryptorAccess or the concrete
// SecurityBarrier implementations) already satisfies those two methods.
// RotateKey extends that surface with the ability to trigger a barrier
// key rotation without exposing the rest of vault.SecurityBarrier (e.g.
// Init, Unseal, Rekey) to callers that only need crypto operations.
type CryptoBarrier interface {
	// Encrypt encrypts the given plaintext under the named key and returns
	// the resulting ciphertext.
	Encrypt(ctx context.Context, key string, plaintext []byte) ([]byte, error)

	// Decrypt decrypts the given ciphertext under the named key and returns
	// the resulting plaintext.
	Decrypt(ctx context.Context, key string, ciphertext []byte) ([]byte, error)

	// RotateKey triggers creation of a new encryption key for the barrier.
	// All future encryptions use the new key, while data encrypted under
	// prior keys remains decryptable.
	RotateKey(ctx context.Context) error
}
