// Copyright IBM Corp. 2026
// SPDX-License-Identifier: BUSL-1.1

package interfaces

import (
	"context"

	log "github.com/hashicorp/go-hclog"

	"github.com/hashicorp/vault/internalshared/metricsutil"
)

// CoreAccess is the minimal surface of vault.Core that seal implementations
// need. It is scoped exactly to the d.core.* call sites in
// vault/seal_autoseal.go: logger access, the sealed-state check, the
// physical seal-config accessors (barrier and recovery, including the
// legacy recovery-config path used during migration), the physical
// storage Get/Put/Delete accessors used to read, write, and clean up
// stored key material, and the two barrier accessors used solely by the
// one-time migration of the recovery seal configuration off its legacy,
// barrier-encrypted storage path.
//
// CoreAccess is intentionally an interface, not a struct embedding, so
// that entCore (Vault Enterprise's extension of Core) and any other Core
// variant can satisfy it without this package knowing about enterprise
// extension points.
//
// Divergence note (WO-015): the original version of this interface (added
// by WO-003) scoped the physical storage accessors to PhysicalGet and
// PhysicalDelete only, based on a partial read of seal_autoseal.go.
// Wiring autoSeal against this interface (WO-015) found four additional,
// real call sites that a "Get/Delete only" surface can't cover:
// SetRecoveryKey and migrateRecoveryConfig both write to physical storage
// (PhysicalPut); migrateRecoveryConfig also reads and deletes the legacy
// recovery-seal-config entry directly from the barrier, not from physical
// storage (BarrierGet/BarrierDelete); and StartHealthCheck's health-check
// goroutine reports seal-availability metrics through Core's metric sink
// (MetricSink). Those four methods were added here to keep CoreAccess
// accurate to every d.core.* (and d.core.physical.*/d.core.barrier.*) call
// site actually present in seal_autoseal.go, rather than leaving autoSeal
// with a partial interface and a type assertion back to *Core.
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

	// PhysicalPut writes an entry directly to physical storage, bypassing
	// the barrier.
	PhysicalPut(ctx context.Context, entry *StorageEntry) error

	// PhysicalDelete removes an entry directly from physical storage,
	// bypassing the barrier.
	PhysicalDelete(ctx context.Context, key string) error

	// BarrierGet reads an entry from the barrier (the encrypted storage
	// layer). It exists solely to support the one-time migration of the
	// recovery seal configuration off its legacy, barrier-encrypted
	// storage path to the plaintext physical path.
	BarrierGet(ctx context.Context, key string) (*StorageEntry, error)

	// BarrierDelete removes an entry from the barrier. See BarrierGet.
	BarrierDelete(ctx context.Context, key string) error

	// MetricSink returns Core's cluster metric sink, used to report
	// seal-availability gauges from the seal health-check loop.
	MetricSink() *metricsutil.ClusterMetricSink
}
