// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: MPL-2.0

package keysutil

import (
	"testing"

	"github.com/hashicorp/vault/sdk/logical"
	"github.com/stretchr/testify/require"
)

// TestFIPSAlgorithmError verifies that FIPSAlgorithmError produces a
// structured response with all three metadata fields populated, a
// human-readable error string, and the logical.ErrInvalidRequest sentinel
// as its error value.
func TestFIPSAlgorithmError(t *testing.T) {
	t.Parallel()

	resp, err := FIPSAlgorithmError(
		"chacha20-poly1305",
		"chacha20-poly1305 is not on the FIPS 140-3 Approved algorithm list",
		"aes256-gcm96",
	)

	// (c) the function returns logical.ErrInvalidRequest as the error value.
	require.Equal(t, logical.ErrInvalidRequest, err)
	require.NotNil(t, resp)

	// The response must still be recognized as an error response: Data may
	// only contain "error" and/or "data" for IsError()/Error() to work, so
	// the structured fields must live under Data["data"], not as
	// additional top-level Data keys.
	require.True(t, resp.IsError())
	require.Len(t, resp.Data, 2, `Data must contain only "error" and "data"`)

	// (a) all three structured fields are present in the response data.
	data, ok := resp.Data["data"].(map[string]interface{})
	require.True(t, ok, `structured fields must be nested under Data["data"]`)
	require.Equal(t, "chacha20-poly1305", data["algorithm"])
	require.Equal(t, "chacha20-poly1305 is not on the FIPS 140-3 Approved algorithm list", data["fips_restriction"])
	require.Equal(t, "aes256-gcm96", data["recommended_alternative"])

	// (b) the error string is human-readable and contains the algorithm
	// name and the recommended alternative, for CLI users who only see the
	// error text.
	errText, ok := resp.Data["error"].(string)
	require.True(t, ok)
	require.Contains(t, errText, "chacha20-poly1305")
	require.Contains(t, errText, "aes256-gcm96")
	require.Contains(t, errText, "FIPS mode")

	// resp.Error() must surface the same human-readable text, since that's
	// what a caller inspecting the *logical.Response (rather than the Data
	// map directly) would see.
	require.EqualError(t, resp.Error(), errText)
}

// TestFIPSAlgorithmError_DifferentInputs verifies the helper is generic
// over its inputs rather than hardcoded to a single algorithm.
func TestFIPSAlgorithmError_DifferentInputs(t *testing.T) {
	t.Parallel()

	resp, err := FIPSAlgorithmError("ed25519", "ed25519 is not on the FIPS 186-5 Approved algorithm list", "ecdsa-p256, ecdsa-p384, or ecdsa-p521")
	require.Equal(t, logical.ErrInvalidRequest, err)

	data, ok := resp.Data["data"].(map[string]interface{})
	require.True(t, ok)
	require.Equal(t, "ed25519", data["algorithm"])
	require.Equal(t, "ed25519 is not on the FIPS 186-5 Approved algorithm list", data["fips_restriction"])
	require.Equal(t, "ecdsa-p256, ecdsa-p384, or ecdsa-p521", data["recommended_alternative"])

	errText, ok := resp.Data["error"].(string)
	require.True(t, ok)
	require.Contains(t, errText, "ed25519")
	require.Contains(t, errText, "ecdsa-p256, ecdsa-p384, or ecdsa-p521")
}
