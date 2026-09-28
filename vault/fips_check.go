// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: BUSL-1.1

package vault

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"strings"
	"time"

	log "github.com/hashicorp/go-hclog"
)

// fipsEnabledPath is the Linux kernel interface that reports whether the
// host has OS-level FIPS mode enabled. A FIPS-tagged Vault binary running on
// a host where this does not report "1" is the exact anti-pattern called
// out by quality gates FIPS-RUNTIME-001 and FIPS-CONTAINER-001 (see
// docs/fips/crypto-provider-verification.md): a FIPS-capable container
// image on a non-FIPS host does not constitute FIPS-aligned operation.
const fipsEnabledPath = "/proc/sys/crypto/fips_enabled"

// opensslProviderCheckTimeout bounds how long the OpenSSL FIPS provider
// verification (an external "openssl" process) is allowed to run, so a
// hung subprocess never blocks Vault startup indefinitely.
const opensslProviderCheckTimeout = 5 * time.Second

// fipsModeVerifiedMessage is logged at INFO level once both the OS-level
// FIPS flag and the OpenSSL FIPS provider have been confirmed active. Per
// this story's constraints, this MUST NOT claim "FIPS validated" or "FIPS
// certified" -- "FIPS mode verified" is a statement about runtime
// configuration, not a certification claim.
const fipsModeVerifiedMessage = "FIPS mode verified: OS-level FIPS enabled, OpenSSL FIPS provider active"

// fipsModeNotEnabledMessage is the operator-facing, actionable message
// logged (and returned as part of the error) whenever the OS-level FIPS
// gate fails, whether because the kernel flag is "0" or because it could
// not be read at all. It is the primary, mandatory gate: a fips=true
// config flag alone is never sufficient without this OS-level check.
const fipsModeNotEnabledMessage = "OS-level FIPS mode not enabled on this host. Set fips=1 kernel parameter or use a FIPS-enabled OS. Vault cannot start in FIPS mode without host-level FIPS enforcement."

// fipsChecker abstracts the host-level FIPS signals verifyFIPSMode inspects
// at startup, so vault/fips_check_test.go can exercise every branch (OS
// flag enabled/disabled/missing, provider active/inactive) without
// requiring an actual FIPS-enabled kernel or a real openssl binary.
type fipsChecker interface {
	// ReadFIPSEnabled returns the raw (untrimmed) contents of
	// /proc/sys/crypto/fips_enabled, or an error if the file could not be
	// read (not found, permission denied, or any other I/O error).
	ReadFIPSEnabled() (string, error)

	// VerifyProvider confirms the OpenSSL FIPS provider is active on this
	// host, e.g. by shelling out to "openssl list -providers" and
	// confirming a "fips" provider is listed.
	VerifyProvider() error
}

// defaultFIPSChecker is the production fipsChecker used by CreateCore: it
// reads the real kernel FIPS flag and shells out to the real openssl
// binary on PATH.
type defaultFIPSChecker struct{}

// ReadFIPSEnabled implements fipsChecker.
func (defaultFIPSChecker) ReadFIPSEnabled() (string, error) {
	data, err := os.ReadFile(fipsEnabledPath)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// VerifyProvider implements fipsChecker by running "openssl list
// -providers" and checking that a "fips" provider is present in the
// output, mirroring the check already performed non-blockingly by
// .release/docker/ubi-docker-entrypoint.sh. Unlike that entrypoint script,
// a failure here is treated as fatal by verifyFIPSMode.
func (defaultFIPSChecker) VerifyProvider() error {
	opensslPath, err := exec.LookPath("openssl")
	if err != nil {
		return fmt.Errorf("openssl binary not found in PATH: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), opensslProviderCheckTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, opensslPath, "list", "-providers")
	output, err := cmd.Output()
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return fmt.Errorf("openssl list -providers timed out after %s", opensslProviderCheckTimeout)
		}
		return fmt.Errorf("failed to run %q: %w", "openssl list -providers", err)
	}

	if !opensslProviderListContainsFIPS(output) {
		return errors.New(`OpenSSL FIPS provider not found in "openssl list -providers" output`)
	}
	return nil
}

// opensslProviderListContainsFIPS reports whether "openssl list
// -providers" output lists an active "fips" provider. Provider names
// appear on their own line, indented (e.g. "  fips"), so each line is
// trimmed and compared exactly -- mirroring the
// `grep -q '^[[:space:]]*fips$'` check in
// .release/docker/ubi-docker-entrypoint.sh.
func opensslProviderListContainsFIPS(output []byte) bool {
	scanner := bufio.NewScanner(bytes.NewReader(output))
	for scanner.Scan() {
		if strings.TrimSpace(scanner.Text()) == "fips" {
			return true
		}
	}
	return false
}

// verifyFIPSMode performs Vault's startup FIPS mode verification: it reads
// the OS-level FIPS flag (the primary, mandatory gate -- a fips=true config
// flag alone is never sufficient) and, only if that passes, verifies the
// OpenSSL FIPS provider is active. checker is injected so unit tests can
// simulate every host state; logger receives the human-readable result
// (INFO on success) so operators see it in normal server logs.
//
// This function does not itself gate on constants.IsFIPS() -- callers (see
// CreateCore) are responsible for only invoking it on FIPS builds. This
// keeps the check itself fully testable from a non-FIPS-tagged test binary.
func verifyFIPSMode(checker fipsChecker, logger log.Logger) error {
	raw, err := checker.ReadFIPSEnabled()
	if err != nil {
		switch {
		case errors.Is(err, fs.ErrNotExist):
			return fmt.Errorf("%s (%s not found: %w; this check requires a Linux host -- "+
				"%s does not exist on non-Linux platforms; run on a FIPS-enabled Linux host)",
				fipsModeNotEnabledMessage, fipsEnabledPath, err, fipsEnabledPath)
		case errors.Is(err, fs.ErrPermission):
			return fmt.Errorf("%s (permission denied reading %s: %w; check the container's "+
				"security context or run as a user with read access to /proc/sys/crypto)",
				fipsModeNotEnabledMessage, fipsEnabledPath, err)
		default:
			return fmt.Errorf("%s (unable to read %s: %w)", fipsModeNotEnabledMessage, fipsEnabledPath, err)
		}
	}

	value := strings.TrimSpace(raw)
	if value != "1" {
		return fmt.Errorf("%s (read %q from %s, expected %q)",
			fipsModeNotEnabledMessage, value, fipsEnabledPath, "1")
	}

	if err := checker.VerifyProvider(); err != nil {
		return fmt.Errorf("FIPS startup check failed: OpenSSL FIPS provider self-test failed: %w "+
			"(see docs/fips/crypto-provider-verification.md)", err)
	}

	logger.Info(fipsModeVerifiedMessage)
	return nil
}
