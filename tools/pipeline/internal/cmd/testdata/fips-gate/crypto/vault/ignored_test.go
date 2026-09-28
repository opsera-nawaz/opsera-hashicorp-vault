package vault

// This file has a disallowed import but must be ignored by the
// crypto-algorithm-check because it is a _test.go file.

import "golang.org/x/crypto/chacha20poly1305"

var _ = chacha20poly1305.KeySize
