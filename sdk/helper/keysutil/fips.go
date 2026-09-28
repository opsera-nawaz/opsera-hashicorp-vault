// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: MPL-2.0

//go:build !fips

package keysutil

// isFIPSMode reports whether this binary was built with the fips build
// tag. It mirrors github.com/hashicorp/vault/helper/constants.IsFIPS(),
// which the rest of Vault (command/server.go, the transit backend) uses
// for the same purpose. It is re-implemented locally, rather than imported,
// because the sdk module must not depend on the root github.com/hashicorp/vault
// module: the root module already depends on sdk (see the top-level go.mod
// replace directive), and sdk is published standalone for external plugin
// authors, so a dependency in the other direction would create a circular
// module dependency. Both implementations are gated by the same "fips"
// build tag, so a Vault binary built with -tags fips gets a consistent
// answer from both.
func isFIPSMode() bool {
	return false
}
