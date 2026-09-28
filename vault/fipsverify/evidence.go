// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

// Package fipsverify collects runtime FIPS verification evidence -- the
// actual negotiated TLS configuration, the active crypto provider
// (BoringCrypto vs standard Go crypto), and the OS-level FIPS mode status --
// as a structured, machine-readable document consumable by audit processes
// and CI enforcement.
//
// This package exists to close the gap flagged by quality gate
// FIPS-RUNTIME-001 (see docs/fips/crypto-provider-verification.md): Vault's
// startup check (vault/fips_check.go, WO-055) verifies FIPS mode once, at
// startup, and only surfaces a pass/fail error -- it does not persist a
// dated, structured evidence document that downstream audit tooling (the
// FIPS evidence package generator,
// tools/pipeline/internal/cmd/generate_fips_evidence.go) or an Enos
// system-integration test can consume. CollectEvidence fills that gap by
// re-deriving the same class of runtime facts (OS-level FIPS flag, active
// crypto provider, listener TLS configuration) independently and on
// demand, from actual runtime state -- never inferred from a configuration
// flag, and never collapsed into a single pass/fail bit.
package fipsverify

// TLSEvidence is a snapshot of the TLS configuration actually in effect on
// a Vault listener, as opposed to Go's unconfigured zero-value defaults.
// Note is set only when no *tls.Config was available to inspect (e.g. TLS
// is not configured on this listener, or the caller has none to provide) --
// that is an expected, non-error condition, never a panic.
type TLSEvidence struct {
	MinVersion       uint16   `json:"min_version"`
	MaxVersion       uint16   `json:"max_version"`
	CipherSuites     []uint16 `json:"cipher_suites"`
	CipherSuiteNames []string `json:"cipher_suite_names"`
	Note             string   `json:"note,omitempty"`
}

// FIPSEvidence is the structured, machine-readable runtime FIPS
// verification result produced by CollectEvidence. Every field is derived
// from actual runtime state (the kernel FIPS flag, the linked crypto
// provider, the caller-supplied tls.Config) except BuildTagFIPS, which is
// explicitly compile-time state. The two are kept as distinct fields --
// rather than collapsed into a single overall verdict -- so a mismatch
// between them (e.g. BuildTagFIPS=true, CryptoProvider="boringcrypto", but
// OSFIPSEnabled=0) is visible directly in the evidence, per this story's
// edge_cases and FIPS-RUNTIME-001.
//
// Per this story's constraints, no field of this struct may ever be
// described as "FIPS validated", "FIPS certified", or "FIPS compliant" --
// this is FIPS-aligned runtime *state*, not a certification claim.
type FIPSEvidence struct {
	// OSFIPSEnabled is the raw integer value read from
	// /proc/sys/crypto/fips_enabled: 1 if the host kernel has FIPS mode
	// enabled, 0 if not, or -1 if the value could not be determined at all
	// (see Errors). -1 is used instead of silently defaulting to 0 so "FIPS
	// disabled" and "FIPS status unknown" (e.g. non-Linux platform, or a
	// container with a restricted /proc mount) are never conflated.
	OSFIPSEnabled int `json:"os_fips_enabled"`

	// CryptoProvider identifies the active Go crypto provider actually
	// linked into this binary: "boringcrypto" or "go-stdlib".
	CryptoProvider string `json:"crypto_provider"`

	// TLSConfig is the actual, explicitly configured TLS settings of the
	// listener whose *tls.Config was passed to CollectEvidence.
	TLSConfig TLSEvidence `json:"tls_config"`

	// BuildTagFIPS is helper/constants.IsFIPS(): the compile-time FIPS
	// build tag state. This is kept separate from the runtime fields above
	// per FIPS-RUNTIME-001 -- compile-time intent is not runtime proof.
	BuildTagFIPS bool `json:"build_tag_fips"`

	// Timestamp is when this evidence was collected, RFC 3339 format.
	Timestamp string `json:"timestamp"`

	// VaultVersion is the running Vault binary's version number.
	VaultVersion string `json:"vault_version"`

	// Errors records any non-fatal collection failures (e.g. the OS FIPS
	// flag could not be read) so partial evidence can still be returned
	// and consumed rather than discarding the whole document.
	Errors []string `json:"errors,omitempty"`
}
