package vault

// This file mimics vault/testing.go, which has a disallowed import but must
// be ignored by the crypto-algorithm-check per the WO-033
// semgrep/golangci-lint exclusion for that specific path.

import "golang.org/x/crypto/chacha20poly1305"

var _ = chacha20poly1305.KeySize
