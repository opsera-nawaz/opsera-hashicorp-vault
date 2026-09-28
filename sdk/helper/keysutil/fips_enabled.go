// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: MPL-2.0

//go:build fips

package keysutil

// isFIPSMode is the fips-tagged counterpart of the implementation in
// fips.go. See that file for why this is a local mirror of
// helper/constants.IsFIPS() rather than an import of it.
func isFIPSMode() bool {
	return true
}
