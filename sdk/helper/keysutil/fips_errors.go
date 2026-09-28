// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: MPL-2.0

package keysutil

import (
	"fmt"

	"github.com/hashicorp/vault/sdk/logical"
)

// FIPSAlgorithmError builds a structured error response for a FIPS-mode
// rejection of a non-Approved algorithm. It lets operators and automation
// tooling programmatically detect a FIPS-mode block -- and learn which
// algorithm was rejected, why, and what to use instead -- without parsing
// the free-text error string.
//
// algorithmName is the requested algorithm/key type that triggered the
// rejection. restriction is a human-readable description of the FIPS
// restriction that applies (e.g. why the algorithm is not Approved).
// recommendedAlternative names an Approved algorithm the caller should use
// instead.
//
// The three metadata fields are nested under Data["data"] rather than set
// as additional top-level keys of Data. This is required, not stylistic:
// logical.Response.IsError() only recognizes a response as an error when
// Data contains exactly "error" (optionally plus "data"); flattening these
// fields directly onto Data would silently make IsError() return false, so
// nothing downstream -- including Vault's core request handling and HTTP
// layers -- would treat this as an error response at all. Nesting under
// "data" also matches how the HTTP layer (http.respondErrorCommon)
// promotes resp.Data["data"] to the top-level "data" section of the JSON
// error body, and mirrors logical.ErrorResponseWithData's convention.
func FIPSAlgorithmError(algorithmName, restriction, recommendedAlternative string) (*logical.Response, error) {
	errMsg := fmt.Sprintf(
		"%s is not allowed in FIPS mode: %s; use %s instead",
		algorithmName, restriction, recommendedAlternative,
	)

	resp := logical.ErrorResponseWithData(map[string]interface{}{
		"algorithm":               algorithmName,
		"fips_restriction":        restriction,
		"recommended_alternative": recommendedAlternative,
	}, errMsg)

	return resp, logical.ErrInvalidRequest
}
