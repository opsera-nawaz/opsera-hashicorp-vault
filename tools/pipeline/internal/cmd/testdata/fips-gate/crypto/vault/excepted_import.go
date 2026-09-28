package vault

import (
	// fips:exception: VLT-9999, tracked in docs/fips/residual-crypto-risk-register.md, expires 2027-01-01
	"golang.org/x/crypto/chacha20poly1305"
)

var _ = chacha20poly1305.KeySize
