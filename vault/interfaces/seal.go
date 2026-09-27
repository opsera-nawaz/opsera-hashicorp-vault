// Copyright IBM Corp. 2026
// SPDX-License-Identifier: BUSL-1.1

package interfaces

import (
	"context"

	wrapping "github.com/hashicorp/go-kms-wrapping/v2"
)

// SealAccess is the contract a seal implementation (e.g. vault's autoSeal
// or defaultSeal) exposes to vault.Core, kept independent of the vault/seal
// package's low-level wrapper types.
//
// It embeds wrapping.InitFinalizer, matching vault/seal.Access, which also
// embeds wrapping.InitFinalizer and has zero vault-package imports.
// SealAccess deliberately does not attempt to mirror vault/seal.Access's
// Encrypt/Decrypt/IsUpToDate methods, since those are expressed in terms of
// seal-package-specific types (seal.MultiWrapValue, seal.SealWrapper);
// reproducing them here would force this package to import vault/seal,
// recreating the exact cycle this package exists to eliminate. Those
// low-level crypto operations are instead represented by CryptoBarrier.
//
// SetCore accepts a CoreAccess rather than a concrete *vault.Core, which is
// what allows a seal implementation to be wired to Core without either
// package importing the other's concrete types.
type SealAccess interface {
	wrapping.InitFinalizer

	// GetSealType returns the configured seal type (e.g. "shamir",
	// "awskms", "multiseal").
	GetSealType() string

	// Verify checks that the seal is correctly configured and able to
	// perform seal/unseal operations.
	Verify(ctx context.Context) error

	// SetCore wires the seal implementation to the CoreAccess it should
	// use for logging, seal-config persistence, and sealed-state queries.
	SetCore(core CoreAccess)
}
