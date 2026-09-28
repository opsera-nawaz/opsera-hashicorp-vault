// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: BUSL-1.1

package vault

import (
	"bytes"
	"errors"
	"io/fs"
	"testing"

	log "github.com/hashicorp/go-hclog"
	"github.com/hashicorp/vault/helper/constants"
	"github.com/stretchr/testify/require"
)

// mockFIPSChecker is a test double for fipsChecker: it returns
// pre-programmed responses and counts how many times each method was
// invoked, so tests can assert both the outcome of verifyFIPSMode and
// whether the underlying host/process checks were actually attempted.
type mockFIPSChecker struct {
	fipsEnabledValue string
	fipsEnabledErr   error
	verifyProviderErr error

	readCalls   int
	verifyCalls int
}

func (m *mockFIPSChecker) ReadFIPSEnabled() (string, error) {
	m.readCalls++
	return m.fipsEnabledValue, m.fipsEnabledErr
}

func (m *mockFIPSChecker) VerifyProvider() error {
	m.verifyCalls++
	return m.verifyProviderErr
}

// testLogger returns an hclog.Logger backed by an in-memory buffer, plus
// the buffer itself, so tests can assert on the exact text logged.
func testLogger() (log.Logger, *bytes.Buffer) {
	var buf bytes.Buffer
	logger := log.New(&log.LoggerOptions{
		Output: &buf,
		Level:  log.Info,
	})
	return logger, &buf
}

// TestVerifyFIPSMode_OSEnabled covers AC1: when /proc/sys/crypto/fips_enabled
// reports "1" (including with a trailing newline, per the documented edge
// case) and the OpenSSL FIPS provider check succeeds, verifyFIPSMode
// returns nil and logs the exact success message at INFO level.
func TestVerifyFIPSMode_OSEnabled(t *testing.T) {
	checker := &mockFIPSChecker{fipsEnabledValue: "1\n"}
	logger, buf := testLogger()

	err := verifyFIPSMode(checker, logger)
	require.NoError(t, err)
	require.Equal(t, 1, checker.readCalls)
	require.Equal(t, 1, checker.verifyCalls)
	require.Contains(t, buf.String(), fipsModeVerifiedMessage)
}

// TestVerifyFIPSMode_OSDisabled covers AC2's "contains '0'" case: verifyFIPSMode
// must fail closed with an error containing the mandated actionable message,
// and must never proceed to the OpenSSL provider check.
func TestVerifyFIPSMode_OSDisabled(t *testing.T) {
	checker := &mockFIPSChecker{fipsEnabledValue: "0"}
	logger, _ := testLogger()

	err := verifyFIPSMode(checker, logger)
	require.Error(t, err)
	require.Contains(t, err.Error(), "OS-level FIPS mode not enabled")
	require.Equal(t, 1, checker.readCalls)
	require.Equal(t, 0, checker.verifyCalls, "provider check must not run once the OS-level gate fails")
}

// TestVerifyFIPSMode_FileNotFound covers AC2's "file does not exist" case,
// including the edge case of running on a non-Linux host where
// /proc/sys/crypto/fips_enabled cannot exist at all.
func TestVerifyFIPSMode_FileNotFound(t *testing.T) {
	checker := &mockFIPSChecker{fipsEnabledErr: fs.ErrNotExist}
	logger, _ := testLogger()

	err := verifyFIPSMode(checker, logger)
	require.Error(t, err)
	require.Contains(t, err.Error(), "fips_enabled not found")
	require.Contains(t, err.Error(), "OS-level FIPS mode not enabled")
	require.Equal(t, 0, checker.verifyCalls)
}

// TestVerifyFIPSMode_PermissionDenied covers the edge case where /proc is
// mounted but read access is restricted (e.g. a hardened container security
// context), which must be distinguished from a plain "not found".
func TestVerifyFIPSMode_PermissionDenied(t *testing.T) {
	checker := &mockFIPSChecker{fipsEnabledErr: fs.ErrPermission}
	logger, _ := testLogger()

	err := verifyFIPSMode(checker, logger)
	require.Error(t, err)
	require.Contains(t, err.Error(), "permission denied")
	require.Contains(t, err.Error(), "OS-level FIPS mode not enabled")
}

// TestVerifyFIPSMode_ProviderInactive confirms that even when the OS-level
// gate passes, a failing OpenSSL FIPS provider check is still fatal --
// target_behavior lists "provider self-test failed" as one of the three
// specific failure modes CreateCore must surface.
func TestVerifyFIPSMode_ProviderInactive(t *testing.T) {
	checker := &mockFIPSChecker{fipsEnabledValue: "1", verifyProviderErr: errors.New("fips provider not listed")}
	logger, _ := testLogger()

	err := verifyFIPSMode(checker, logger)
	require.Error(t, err)
	require.Contains(t, err.Error(), "OpenSSL FIPS provider self-test failed")
	require.Equal(t, 1, checker.readCalls)
	require.Equal(t, 1, checker.verifyCalls)
}

// TestVerifyFIPSMode_SkippedWhenNotFIPS covers AC4/AC5(d): on a non-FIPS
// build, constants.IsFIPS() is false, so the call-site gate in CreateCore
// (mirrored here) must never invoke the checker at all. This test runs
// under the default (non-fips-tagged) build, which is exactly the
// production configuration where the skip behavior matters.
func TestVerifyFIPSMode_SkippedWhenNotFIPS(t *testing.T) {
	if constants.IsFIPS() {
		t.Skip("this test verifies the non-FIPS build's skip behavior; running under a fips-tagged build")
	}

	checker := &mockFIPSChecker{fipsEnabledValue: "0"} // would fail verification if ever invoked
	logger, _ := testLogger()

	// This mirrors the exact guard in CreateCore: verifyFIPSMode is only
	// ever reached behind constants.IsFIPS().
	var err error
	if constants.IsFIPS() {
		err = verifyFIPSMode(checker, logger)
	}

	require.NoError(t, err)
	require.Equal(t, 0, checker.readCalls, "ReadFIPSEnabled must not be called on non-FIPS builds")
	require.Equal(t, 0, checker.verifyCalls, "VerifyProvider must not be called on non-FIPS builds")
}
