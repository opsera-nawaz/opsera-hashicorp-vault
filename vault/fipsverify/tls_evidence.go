// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package fipsverify

import "crypto/tls"

// extractTLSEvidence reads MinVersion, MaxVersion, and CipherSuites from
// cfg and maps each cipher suite ID to its human-readable name via
// tls.CipherSuiteName(). cfg is accepted as a parameter -- never read from
// a package-level global -- so a caller captures a consistent snapshot
// even if the listener's TLS configuration is reloaded concurrently, and
// so the evidence records the actual configured values, not Go's
// unconfigured defaults.
//
// If cfg is nil (e.g. TLS is not configured on this listener, or the
// caller has no live listener to inspect), extractTLSEvidence returns a
// zero-value TLSEvidence with Note set, rather than panicking.
func extractTLSEvidence(cfg *tls.Config) TLSEvidence {
	if cfg == nil {
		return TLSEvidence{Note: "no tls.Config was provided to CollectEvidence; TLS configuration was not captured"}
	}

	cipherSuites := append([]uint16(nil), cfg.CipherSuites...)
	names := make([]string, 0, len(cipherSuites))
	for _, id := range cipherSuites {
		names = append(names, tls.CipherSuiteName(id))
	}

	return TLSEvidence{
		MinVersion:       cfg.MinVersion,
		MaxVersion:       cfg.MaxVersion,
		CipherSuites:     cipherSuites,
		CipherSuiteNames: names,
	}
}
