// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package cmd

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/spf13/cobra"
)

// defaultTLSCheckPaths are the two locations where a Vault server config
// listener's tls_min_version can be set in this repository: the shared
// config parsing package and the CLI commands that construct config
// directly.
var defaultTLSCheckPaths = []string{
	"internalshared/configutil",
	"command",
}

// tlsMinVersionBelow12Regex matches an explicit tls_min_version assignment
// (HCL attribute syntax, e.g. `tls_min_version = "1.0"`) whose value is the
// literal string "1.0" or "1.1" -- both below TLS 1.2.
var tlsMinVersionBelow12Regex = regexp.MustCompile(`(?i)tls_min_version\s*[:=]\s*['"]?(1\.0|1\.1)['"]?`)

// tlsGoVersionConstantBelow12Regex matches Go code referencing the
// below-1.2 crypto/tls package version constants directly, e.g.
// `MinVersion: tls.VersionTLS10`.
var tlsGoVersionConstantBelow12Regex = regexp.MustCompile(`\btls\.VersionTLS1[01]\b`)

// TLSConfigFinding is a single tls_min_version-below-1.2 occurrence.
type TLSConfigFinding struct {
	File  string `json:"file"`
	Line  int    `json:"line"`
	Match string `json:"match"`
}

// TLSConfigCheckResult is the aggregate outcome of scanning one or more
// directory trees for a TLS minimum version regression below TLS 1.2.
type TLSConfigCheckResult struct {
	FilesScanned int                `json:"filesScanned"`
	Findings     []TLSConfigFinding `json:"findings"`
}

// Passed reports whether the scan found zero below-1.2 configurations.
func (r *TLSConfigCheckResult) Passed() bool {
	return len(r.Findings) == 0
}

// ToJSON renders the result as indented JSON.
func (r *TLSConfigCheckResult) ToJSON() ([]byte, error) {
	return json.MarshalIndent(r, "", "  ")
}

// TLSConfigCheck scans HCL (*.hcl) and Go (*.go) files under each root for a
// tls_min_version setting (HCL attribute syntax, or the equivalent Go
// tls.VersionTLS10/tls.VersionTLS11 constants) below TLS 1.2. A root that
// does not exist is skipped without error.
func TLSConfigCheck(roots []string) (*TLSConfigCheckResult, error) {
	result := &TLSConfigCheckResult{}

	for _, root := range roots {
		if _, err := os.Stat(root); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, fmt.Errorf("tls config check: statting %s: %w", root, err)
		}

		walkErr := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				slog.Default().Warn("tls config check: unable to walk path", "path", path, "error", err)
				return nil
			}
			if d.IsDir() {
				return nil
			}
			if !strings.HasSuffix(path, ".go") && !strings.HasSuffix(path, ".hcl") {
				return nil
			}

			content, readErr := os.ReadFile(path)
			if readErr != nil {
				slog.Default().Warn("tls config check: unable to read file, skipping", "path", path, "error", readErr)
				return nil
			}

			result.FilesScanned++
			result.Findings = append(result.Findings, scanTLSConfigContent(path, content)...)
			return nil
		})
		if walkErr != nil {
			return nil, fmt.Errorf("tls config check: walking %s: %w", root, walkErr)
		}
	}

	sort.Slice(result.Findings, func(i, j int) bool {
		if result.Findings[i].File != result.Findings[j].File {
			return result.Findings[i].File < result.Findings[j].File
		}
		return result.Findings[i].Line < result.Findings[j].Line
	})

	return result, nil
}

// scanTLSConfigContent scans a single file's content, line by line, for a
// tls_min_version assignment or Go version constant reference below TLS
// 1.2.
func scanTLSConfigContent(path string, content []byte) []TLSConfigFinding {
	var findings []TLSConfigFinding
	lines := strings.Split(string(content), "\n")
	for i, line := range lines {
		match := tlsMinVersionBelow12Regex.FindString(line)
		if match == "" {
			match = tlsGoVersionConstantBelow12Regex.FindString(line)
		}
		if match == "" {
			continue
		}
		findings = append(findings, TLSConfigFinding{
			File:  path,
			Line:  i + 1,
			Match: strings.TrimSpace(match),
		})
	}
	return findings
}

func newFipsTLSCheckCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "fips-tls-check [paths]...",
		Short: "Block a TLS minimum version regression below TLS 1.2",
		Long: `Scan internalshared/configutil/ and command/ (or explicit path
arguments) for a tls_min_version setting -- in HCL attribute syntax or the
equivalent Go tls.VersionTLS10/tls.VersionTLS11 constants -- that regresses
below TLS 1.2.

Examples:
  pipeline fips-tls-check
  pipeline fips-tls-check tools/pipeline/internal/cmd/testdata/fips-gate/tls`,
		RunE: runFipsTLSCheckCmd,
	}

	return cmd
}

func runFipsTLSCheckCmd(cmd *cobra.Command, args []string) error {
	cmd.SilenceUsage = true // Don't spam the usage on failure

	roots := args
	if len(roots) == 0 {
		roots = resolveRepoRootedPaths(rootCfg.repoRoot, defaultTLSCheckPaths)
	}

	res, err := TLSConfigCheck(roots)
	if err != nil {
		return fmt.Errorf("tls config check: %w", err)
	}

	switch rootCfg.format {
	case "json":
		b, jsonErr := res.ToJSON()
		if jsonErr != nil {
			return jsonErr
		}
		fmt.Println(string(b))
	default:
		for _, f := range res.Findings {
			fmt.Printf("%s:%d: tls_min_version regression below TLS 1.2: %s\n", f.File, f.Line, f.Match)
		}
		fmt.Printf("tls-config-check: scanned %d file(s), %d finding(s)\n", res.FilesScanned, len(res.Findings))
	}

	if !res.Passed() {
		return fmt.Errorf("tls-config-check: found %d tls_min_version regression(s) below TLS 1.2", len(res.Findings))
	}

	return nil
}
