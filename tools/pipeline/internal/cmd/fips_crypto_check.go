// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package cmd

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
)

// defaultCryptoCheckPaths are the security-relevant paths identified in the
// Phase 1 crypto inventory (fips/crypto_inventory.yaml) and already encoded
// as the scope of the WO-033 semgrep/depguard rules
// (tools/semgrep/ci/fips-crypto-imports.yml, .golangci.yml
// fips-crypto-restrictions rule). The crypto-algorithm-check CI gate
// re-checks the same scope with a dedicated Go analysis tool so the
// regression gate does not depend solely on semgrep/golangci-lint being
// wired correctly on every path.
var defaultCryptoCheckPaths = []string{
	"vault",
	"sdk/helper/keysutil",
	"builtin/logical",
}

// disallowedCryptoImports maps a disallowed import path to the human
// readable reason/Approved-alternative surfaced in findings.
var disallowedCryptoImports = map[string]string{
	"golang.org/x/crypto/chacha20poly1305": "not an Approved algorithm under FIPS 140-3; use AES-GCM (crypto/aes + crypto/cipher) instead of ChaCha20-Poly1305",
	"crypto/ed25519":                       "not an Approved algorithm under FIPS 140-3; use ECDSA (crypto/ecdsa) instead of Ed25519",
}

// cryptoCheckExceptionMarker is the comment substring that exempts an
// otherwise-disallowed import from being flagged, when attached directly to
// the import spec as either a leading doc comment or a trailing line
// comment, e.g.:
//
//	import (
//	    // fips:exception: VLT-1234, approved 2026-01-01, see docs/fips/residual-crypto-risk-register.md
//	    "golang.org/x/crypto/chacha20poly1305"
//	)
const cryptoCheckExceptionMarker = "fips:exception"

// CryptoImportFinding is a single disallowed-import occurrence with no
// adjacent //fips:exception comment.
type CryptoImportFinding struct {
	File   string `json:"file"`
	Line   int    `json:"line"`
	Import string `json:"import"`
	Reason string `json:"reason"`
}

// CryptoAlgorithmCheckResult is the aggregate outcome of scanning one or
// more directory trees for disallowed cryptographic imports.
type CryptoAlgorithmCheckResult struct {
	FilesScanned int                   `json:"filesScanned"`
	Findings     []CryptoImportFinding `json:"findings"`
}

// Passed reports whether the scan found zero unexcepted disallowed imports.
func (r *CryptoAlgorithmCheckResult) Passed() bool {
	return len(r.Findings) == 0
}

// ToJSON renders the result as indented JSON.
func (r *CryptoAlgorithmCheckResult) ToJSON() ([]byte, error) {
	return json.MarshalIndent(r, "", "  ")
}

// CryptoAlgorithmCheck walks each root and flags any production Go file
// that imports a disallowed cryptographic package
// (golang.org/x/crypto/chacha20poly1305, crypto/ed25519) without a
// //fips:exception comment attached to the import spec.
//
// Test files (*_test.go) and vault/testing.go are excluded from scanning,
// matching the WO-033 semgrep/golangci-lint paths.exclude entries exactly
// (edge_cases: "the check must distinguish test files from production code
// and only flag production imports"). A root that does not exist is
// skipped without error, since not every checkout (e.g. a fixture tree in
// a unit test) will have all three security-relevant directories.
func CryptoAlgorithmCheck(roots []string) (*CryptoAlgorithmCheckResult, error) {
	result := &CryptoAlgorithmCheckResult{}
	fset := token.NewFileSet()

	for _, root := range roots {
		if _, err := os.Stat(root); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, fmt.Errorf("crypto algorithm check: statting %s: %w", root, err)
		}

		walkErr := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				slog.Default().Warn("crypto algorithm check: unable to walk path", "path", path, "error", err)
				return nil
			}
			if d.IsDir() || !strings.HasSuffix(path, ".go") {
				return nil
			}
			if isCryptoCheckExcludedFile(path) {
				return nil
			}

			result.FilesScanned++
			findings, parseErr := scanGoFileForCryptoImports(fset, path)
			if parseErr != nil {
				slog.Default().Warn("crypto algorithm check: unable to parse Go file, skipping", "path", path, "error", parseErr)
				return nil
			}
			result.Findings = append(result.Findings, findings...)
			return nil
		})
		if walkErr != nil {
			return nil, fmt.Errorf("crypto algorithm check: walking %s: %w", root, walkErr)
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

// isCryptoCheckExcludedFile reports whether path is out of scope for the
// crypto-algorithm-check: test files and vault/testing.go, mirroring the
// WO-033 semgrep/golangci-lint exclusions.
func isCryptoCheckExcludedFile(path string) bool {
	if strings.HasSuffix(path, "_test.go") {
		return true
	}
	clean := filepath.ToSlash(path)
	return clean == "vault/testing.go" || strings.HasSuffix(clean, "/vault/testing.go")
}

// scanGoFileForCryptoImports parses a single Go file and returns a finding
// for each disallowed import that lacks a //fips:exception comment attached
// directly to the import spec (as a leading Doc comment or trailing line
// Comment).
func scanGoFileForCryptoImports(fset *token.FileSet, path string) ([]CryptoImportFinding, error) {
	file, err := parser.ParseFile(fset, path, nil, parser.ParseComments|parser.ImportsOnly)
	if err != nil {
		return nil, err
	}

	var findings []CryptoImportFinding
	for _, decl := range file.Decls {
		genDecl, ok := decl.(*ast.GenDecl)
		if !ok || genDecl.Tok != token.IMPORT {
			continue
		}
		for _, spec := range genDecl.Specs {
			imp, ok := spec.(*ast.ImportSpec)
			if !ok {
				continue
			}
			importPath, unquoteErr := strconv.Unquote(imp.Path.Value)
			if unquoteErr != nil {
				continue
			}
			reason, disallowed := disallowedCryptoImports[importPath]
			if !disallowed {
				continue
			}
			if importSpecHasExceptionComment(imp) {
				continue
			}
			findings = append(findings, CryptoImportFinding{
				File:   path,
				Line:   fset.Position(imp.Pos()).Line,
				Import: importPath,
				Reason: reason,
			})
		}
	}
	return findings, nil
}

// importSpecHasExceptionComment reports whether imp carries a directly
// attached //fips:exception comment, either as a leading Doc comment (the
// common case for a grouped import block) or a trailing line Comment.
func importSpecHasExceptionComment(imp *ast.ImportSpec) bool {
	if imp.Doc != nil && strings.Contains(imp.Doc.Text(), cryptoCheckExceptionMarker) {
		return true
	}
	if imp.Comment != nil && strings.Contains(imp.Comment.Text(), cryptoCheckExceptionMarker) {
		return true
	}
	return false
}

// resolveRepoRootedPaths joins each relative path in rel with repoRoot. When
// repoRoot is empty the relative paths are returned unmodified so commands
// still behave when run directly from the repository root.
func resolveRepoRootedPaths(repoRoot string, rel []string) []string {
	if repoRoot == "" {
		return append([]string(nil), rel...)
	}
	out := make([]string, len(rel))
	for i, r := range rel {
		out[i] = filepath.Join(repoRoot, r)
	}
	return out
}

func newFipsCryptoCheckCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "fips-crypto-check [paths]...",
		Short: "Block disallowed cryptographic imports on FIPS-relevant paths",
		Long: `Scan vault/, sdk/helper/keysutil/, and builtin/logical/ (or explicit
path arguments) for imports of golang.org/x/crypto/chacha20poly1305 or
crypto/ed25519 that are not accompanied by a directly attached
//fips:exception comment on the import spec. Test files (*_test.go) and
vault/testing.go are always out of scope.

Examples:
  pipeline fips-crypto-check
  pipeline fips-crypto-check tools/pipeline/internal/cmd/testdata/fips-gate/crypto`,
		RunE: runFipsCryptoCheckCmd,
	}

	return cmd
}

func runFipsCryptoCheckCmd(cmd *cobra.Command, args []string) error {
	cmd.SilenceUsage = true // Don't spam the usage on failure

	roots := args
	if len(roots) == 0 {
		roots = resolveRepoRootedPaths(rootCfg.repoRoot, defaultCryptoCheckPaths)
	}

	res, err := CryptoAlgorithmCheck(roots)
	if err != nil {
		return fmt.Errorf("crypto algorithm check: %w", err)
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
			fmt.Printf("%s:%d: disallowed import %q: %s\n", f.File, f.Line, f.Import, f.Reason)
		}
		fmt.Printf("crypto-algorithm-check: scanned %d file(s), %d finding(s)\n", res.FilesScanned, len(res.Findings))
	}

	if !res.Passed() {
		return fmt.Errorf("crypto-algorithm-check: found %d disallowed crypto import(s) without a //fips:exception comment", len(res.Findings))
	}

	return nil
}
