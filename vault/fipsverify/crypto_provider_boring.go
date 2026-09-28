// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

//go:build boringcrypto

package fipsverify

import "crypto/boring"

// detectCryptoProvider reports the active Go crypto provider linked into
// this binary. This build-tag-conditional variant is compiled only when
// the binary was built with GOEXPERIMENT=boringcrypto -- crypto/boring
// (the package Enabled() comes from) is itself only importable under that
// same "boringcrypto" build tag, following the same build-tag-conditional
// pattern already established for helper/constants.IsFIPS() (see
// helper/constants/fips.go, fips_fips.go). boring.Enabled() additionally
// confirms the BoringCrypto core was actually initialized at runtime (e.g.
// linux/amd64 or linux/arm64 with cgo), not merely linked in, so a
// GOEXPERIMENT=boringcrypto build running on an unsupported platform
// correctly falls back to reporting "go-stdlib".
func detectCryptoProvider() string {
	if boring.Enabled() {
		return "boringcrypto"
	}
	return "go-stdlib"
}
