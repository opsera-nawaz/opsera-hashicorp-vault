// Copyright IBM Corp. 2026
// SPDX-License-Identifier: BUSL-1.1

// Package interfaces is the dependency-inversion boundary for Vault's
// crypto and seal subsystems.
//
// vault/core, vault/seal, vault/barrier_aes_gcm, and sdk/helper/keysutil
// have historically been coupled through concrete types (e.g. autoSeal
// holding a *vault.Core, and vault.Core.NewCore calling
// c.seal.SetCore(c)), which produces circular package dependencies. This
// package breaks that coupling by defining the narrow interfaces that
// crypto/seal modules actually consume from one another:
//
//   - CoreAccess is the minimal surface of vault.Core that seal
//     implementations (e.g. autoSeal) need: logging, sealed state, and
//     the physical seal-config accessors.
//   - SealAccess is the lifecycle/management surface a seal implementation
//     exposes back to vault.Core (Init/Finalize plus core wiring), kept
//     independent of vault/seal.Access's low-level wrapper types so that
//     this package never has to import vault/seal.
//   - CryptoBarrier is the minimal encrypt/decrypt/rotate surface that
//     storage-encryption consumers (e.g. sdk/helper/keysutil,
//     vault/barrier_aes_gcm) need from a barrier, modeled on
//     vault/barrier_access.go's BarrierEncryptor.
//
// This package intentionally has zero imports from vault/, vault/seal/,
// sdk/, or builtin/ so that any of those packages can depend on it
// without creating an import cycle. Concrete types in those packages are
// expected to implement these interfaces; this package does not import
// or reference them.
package interfaces
