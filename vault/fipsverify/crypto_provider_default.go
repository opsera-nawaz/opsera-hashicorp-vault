// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

//go:build !boringcrypto

package fipsverify

// detectCryptoProvider reports the active Go crypto provider linked into
// this binary. This is the default variant, compiled whenever the binary
// was NOT built with GOEXPERIMENT=boringcrypto -- crypto/boring is only
// importable under the "boringcrypto" build tag (see
// crypto_provider_boring.go), so there is no runtime symbol to check here:
// standard Go crypto/* is unconditionally the active provider for this
// build.
func detectCryptoProvider() string {
	return "go-stdlib"
}
