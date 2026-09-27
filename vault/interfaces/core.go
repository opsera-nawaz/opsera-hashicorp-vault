// Copyright IBM Corp. 2026
// SPDX-License-Identifier: BUSL-1.1

package interfaces

import (
	"context"

	log "github.com/hashicorp/go-hclog"
)

// CoreAccess is the minimal surface of vault.Core that seal implementations
// need. It is scoped exactly to the d.core.* call sites in
// vault/seal_autoseal.go: logger access, the sealed-state check, the
// physical seal-config accessors (barrier and recovery, including the
// legacy recovery-config path used during migration), and the physical
// storage Get/Delete accessors used to read and clean up stored key
// material.
//
// CoreAccess is intentionally an interface, not a struct embedding, so
// that entCore (Vault Enterprise's extension of Core) and any other Core
// variant can satisfy it without this package knowing about enterprise
// extension points.
type CoreAccess interface {
	// Logger returns Core's logger.
	Logger() log.Logger

	// AddLogger registers an additional logger with Core.
	AddLogger(logger log.Logger)

	// Sealed reports whether Core is currently sealed.
	Sealed() bool

	// PhysicalBarrierSealConfig reads the barrier seal configuration
	// directly from physical storage, bypassing the barrier.
	PhysicalBarrierSealConfig(ctx context.Context) (*SealConfig, error)

	// SetPhysicalBarrierSealConfig writes the barrier seal configuration
	// directly to physical storage, bypassing the barrier.
	SetPhysicalBarrierSealConfig(ctx context.Context, barrierSealConfig *SealConfig) error

	// PhysicalRecoverySealConfig reads the recovery seal configuration
	// directly from physical storage, bypassing the barrier.
	PhysicalRecoverySealConfig(ctx context.Context) (*SealConfig, error)

	// SetPhysicalRecoverySealConfig writes the recovery seal configuration
	// directly to physical storage, bypassing the barrier.
	SetPhysicalRecoverySealConfig(ctx context.Context, recoverySealConfig *SealConfig) error

	// PhysicalRecoverySealConfigOldPath reads the recovery seal
	// configuration from the deprecated storage path used before recovery
	// config was stored in plaintext. It returns a nil config and a nil
	// error when no entry exists at the legacy path, which is the normal
	// case once a cluster has migrated.
	PhysicalRecoverySealConfigOldPath(ctx context.Context) (*SealConfig, error)

	// PhysicalGet reads an entry directly from physical storage, bypassing
	// the barrier.
	PhysicalGet(ctx context.Context, key string) (*StorageEntry, error)

	// PhysicalDelete removes an entry directly from physical storage,
	// bypassing the barrier.
	PhysicalDelete(ctx context.Context, key string) error
}
