// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package fipsverify

import (
	"context"
	"crypto/tls"
	"time"

	"github.com/hashicorp/vault/helper/constants"
	"github.com/hashicorp/vault/version"
)

// CollectEvidence gathers runtime FIPS verification evidence: the OS-level
// FIPS mode flag, the active crypto provider, the configured TLS settings
// for the listener described by tlsConfig, and the compile-time FIPS build
// tag state, and returns it as a structured, machine-readable FIPSEvidence
// document.
//
// ctx bounds the call: it is checked before collection starts so a caller
// that has already canceled never gets a stale evidence document back as
// if collection had succeeded. (The individual collection steps -- a
// single file read, a build-tag-selected function call, and reading fields
// off an in-memory struct -- are synchronous and not themselves
// cancelable.)
//
// tlsConfig is accepted as a parameter, not read from a package or Vault
// core global, so the caller captures one consistent snapshot even if the
// listener's TLS configuration is reloaded concurrently with collection.
//
// If the OS-level FIPS flag cannot be read (e.g. running on a non-Linux
// platform, or a container whose /proc is mounted read-only or otherwise
// restricted), CollectEvidence does not silently report FIPS as disabled:
// it still returns the rest of the evidence it was able to collect, with
// OSFIPSEnabled set to -1 and the specific failure reason recorded in both
// FIPSEvidence.Errors and the returned error, so partial evidence
// collection is possible rather than a total failure.
func CollectEvidence(ctx context.Context, tlsConfig *tls.Config) (*FIPSEvidence, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	evidence := &FIPSEvidence{
		CryptoProvider: detectCryptoProvider(),
		TLSConfig:      extractTLSEvidence(tlsConfig),
		BuildTagFIPS:   constants.IsFIPS(),
		Timestamp:      time.Now().UTC().Format(time.RFC3339),
		VaultVersion:   version.GetVersion().VersionNumber(),
	}

	osFIPSEnabled, err := readOSFIPSEnabled(defaultFIPSEnabledPath)
	if err != nil {
		evidence.OSFIPSEnabled = -1
		evidence.Errors = append(evidence.Errors, err.Error())
		return evidence, err
	}
	evidence.OSFIPSEnabled = osFIPSEnabled

	return evidence, nil
}
