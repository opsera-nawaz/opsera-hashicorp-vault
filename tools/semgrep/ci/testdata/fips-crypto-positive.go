// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: BUSL-1.1

// Positive fixture for tools/semgrep/ci/fips-crypto-imports.yml.
// Imports of non-Approved FIPS 140-3 algorithms below MUST be flagged
// (severity ERROR, FIPS-CRYPTO-002) by the fips-crypto-*-import rules.
// Covers the plain, aliased, and dot-import forms called out in WO-033's
// edge cases so the rule is proven to catch all three.
package testdata

// ruleid: fips-crypto-chacha20poly1305-import
import "golang.org/x/crypto/chacha20poly1305"

// ruleid: fips-crypto-ed25519-import
import ed "golang.org/x/crypto/ed25519"

// ruleid: fips-crypto-curve25519-import
import . "golang.org/x/crypto/curve25519"

func encrypt(key []byte) {
	_, _ = chacha20poly1305.New(key)
	_, _, _ = ed.GenerateKey(nil)
	var scalar, point [32]byte
	_, _ = X25519(scalar[:], point[:])
}
