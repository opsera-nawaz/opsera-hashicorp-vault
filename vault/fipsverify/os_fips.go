// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package fipsverify

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strconv"
	"strings"
)

// defaultFIPSEnabledPath is the Linux kernel interface that reports whether
// the host has OS-level FIPS mode enabled. It mirrors the constant of the
// same purpose in vault/fips_check.go (fipsEnabledPath). It is duplicated
// here, rather than imported, because vault/fips_check.go does not export
// it and this package must remain importable independently of package
// vault (e.g. from the standalone "vault fips-verify" CLI command).
//
// In containerized environments, /proc may be mounted from the host --
// this reads whatever /proc/sys/crypto/fips_enabled resolves to for this
// process, which is the host's actual FIPS status when /proc is host-
// mounted (the common case), not a container-local override.
const defaultFIPSEnabledPath = "/proc/sys/crypto/fips_enabled"

// readOSFIPSEnabled reads procPath (defaulting to defaultFIPSEnabledPath
// when empty), trims surrounding whitespace -- the kernel interface may
// include a trailing newline -- and parses the result as an integer. It
// never returns 0 on failure: silently assuming FIPS is disabled when the
// flag simply could not be read (e.g. on a non-Linux platform where the
// path does not exist, or a hardened container security context that
// denies read access) is exactly the anti-pattern FIPS-RUNTIME-001 flags,
// so callers must be able to distinguish "read 0" from "could not read".
func readOSFIPSEnabled(procPath string) (int, error) {
	if procPath == "" {
		procPath = defaultFIPSEnabledPath
	}

	raw, err := os.ReadFile(procPath)
	if err != nil {
		switch {
		case errors.Is(err, fs.ErrNotExist):
			return 0, fmt.Errorf("unable to read FIPS status: %s not found: %w; this check requires a Linux host -- "+
				"/proc/sys/crypto/fips_enabled does not exist on non-Linux platforms", procPath, err)
		case errors.Is(err, fs.ErrPermission):
			return 0, fmt.Errorf("unable to read FIPS status: permission denied reading %s: %w; check the container's "+
				"security context or run as a user with read access to /proc/sys/crypto", procPath, err)
		default:
			return 0, fmt.Errorf("unable to read FIPS status: failed to read %s: %w", procPath, err)
		}
	}

	value := strings.TrimSpace(string(raw))
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("unable to read FIPS status: %s contained unexpected content %q: %w", procPath, value, err)
	}

	return parsed, nil
}
