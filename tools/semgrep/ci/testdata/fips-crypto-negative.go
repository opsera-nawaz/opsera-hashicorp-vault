// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: BUSL-1.1

// Negative fixture for tools/semgrep/ci/fips-crypto-imports.yml.
// Uses Approved FIPS 140-3 algorithms only — no fips-crypto-*-import
// finding should be produced for this file.
package testdata

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdsa"
)

func encrypt(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func sign() *ecdsa.PrivateKey {
	return nil
}
