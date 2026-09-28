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

// overclaimProhibitedPhrases is the set of affirmative FIPS-validation
// claims that are never allowed in release-facing text (changelog entries,
// release notes, CHANGELOG files) unless accompanied by a specific CMVP
// certificate reference. These are exactly the phrases the FIPS Phase 4
// anti-pattern rule prohibits: a claim of validation/certification/
// compliance status with no dated, verifiable evidence attached.
var overclaimProhibitedPhrases = []string{
	"FIPS validated",
	"FIPS certified",
	"FIPS compliant",
	"is FIPS compliant",
	"FIPS 140-3 validated",
	"FIPS 140-3 certified",
	"FIPS 140-2 validated",
}

// overclaimApprovedPhrases documents the disclaimer-safe alternatives that
// this check must never flag. They describe a posture/alignment rather than
// an affirmative validation or certification claim, matching the convention
// already established across docs/fips/*.md and fips/*.yaml in this repo.
var overclaimApprovedPhrases = []string{
	"FIPS-aligned",
	"FIPS-aligned posture",
	"FIPS 140-3 alignment",
}

// overclaimCMVPProximityWindow is the number of characters searched on
// either side of a prohibited-phrase match for an adjacent CMVP certificate
// reference. Kept as a named constant so it is easy to retune later without
// hunting through the scanning logic.
const overclaimCMVPProximityWindow = 200

// overclaimPhraseRegexes are compiled once at package init from
// overclaimProhibitedPhrases. Each phrase is matched case-insensitively with
// word boundaries around the whole phrase (and collapsible internal
// whitespace) so that compound terms like "FIPS-path" or "FIPS-aligned" can
// never match a multi-word prohibited phrase.
var overclaimPhraseRegexes = compileOverclaimPhraseRegexes(overclaimProhibitedPhrases)

// overclaimCMVPReferenceRegex matches a CMVP certificate reference such as
// "CMVP #4523".
var overclaimCMVPReferenceRegex = regexp.MustCompile(`(?i)CMVP\s*#\s*[0-9]+`)

func compileOverclaimPhraseRegexes(phrases []string) map[string]*regexp.Regexp {
	out := make(map[string]*regexp.Regexp, len(phrases))
	for _, phrase := range phrases {
		words := strings.Fields(phrase)
		for i, w := range words {
			words[i] = regexp.QuoteMeta(w)
		}
		pattern := `\b` + strings.Join(words, `\s+`) + `\b`
		out[phrase] = regexp.MustCompile(`(?i)` + pattern)
	}
	return out
}

// OverclaimFinding is a single prohibited-phrase occurrence that has no
// adjacent CMVP certificate reference, i.e. an unevidenced FIPS overclaim.
type OverclaimFinding struct {
	File   string `json:"file"`
	Line   int    `json:"line"`
	Phrase string `json:"phrase"`
}

// OverclaimResult is the aggregate outcome of scanning a directory tree for
// FIPS overclaiming language.
type OverclaimResult struct {
	FilesScanned int                `json:"filesScanned"`
	Findings     []OverclaimFinding `json:"findings"`
}

// Passed reports whether the scan found zero unevidenced overclaims.
func (r *OverclaimResult) Passed() bool {
	return len(r.Findings) == 0
}

// ToJSON renders the result as indented JSON.
func (r *OverclaimResult) ToJSON() ([]byte, error) {
	return json.MarshalIndent(r, "", "  ")
}

// OverclaimCheck scans path for affirmative FIPS-validated/certified/
// compliant claims that lack an adjacent CMVP certificate reference. path
// may be a single file or a directory; directories are walked recursively
// and every regular text file found is scanned. Per the acceptance
// criteria, the caller is expected to invoke OverclaimCheck against the
// changelog/ directory and against any file matching the *release-note*/
// *CHANGELOG* glob (the CLI command supports multiple path arguments for
// exactly this purpose).
//
// If path does not exist, OverclaimCheck returns an empty, passing result
// and a nil error (there is nothing to scan, so there is nothing to
// block). If an individual file cannot be read, the error is logged as a
// warning and the scan continues with the remaining files.
func OverclaimCheck(path string) (*OverclaimResult, error) {
	result := &OverclaimResult{}

	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return result, nil
		}
		return nil, fmt.Errorf("statting %s: %w", path, err)
	}

	scanFile := func(p string) {
		content, readErr := os.ReadFile(p)
		if readErr != nil {
			slog.Default().Warn("fips overclaim check: unable to read file", "path", p, "error", readErr)
			return
		}
		if looksBinary(content) {
			return
		}

		result.FilesScanned++
		result.Findings = append(result.Findings, scanOverclaimContent(p, content)...)
	}

	if !info.IsDir() {
		scanFile(path)
	} else {
		walkErr := filepath.WalkDir(path, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				slog.Default().Warn("fips overclaim check: unable to walk path", "path", p, "error", err)
				return nil
			}
			if d.IsDir() {
				return nil
			}
			scanFile(p)
			return nil
		})
		if walkErr != nil {
			return nil, fmt.Errorf("scanning %s for FIPS overclaiming language: %w", path, walkErr)
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

// looksBinary is a cheap heuristic to skip non-text files: presence of a
// NUL byte in the first chunk of content is a strong signal of binary data.
func looksBinary(content []byte) bool {
	probe := content
	if len(probe) > 8000 {
		probe = probe[:8000]
	}
	return strings.ContainsRune(string(probe), '\x00')
}

// scanOverclaimContent scans a single file's content for prohibited FIPS
// phrases and returns a finding for each occurrence that lacks a CMVP
// certificate reference within overclaimCMVPProximityWindow characters
// (searched across the whole file, so the reference may be on a different
// line than the prohibited phrase).
func scanOverclaimContent(path string, content []byte) []OverclaimFinding {
	text := string(content)

	var findings []OverclaimFinding
	for _, phrase := range overclaimProhibitedPhrases {
		re := overclaimPhraseRegexes[phrase]
		for _, loc := range re.FindAllStringIndex(text, -1) {
			start, end := loc[0], loc[1]

			windowStart := start - overclaimCMVPProximityWindow
			if windowStart < 0 {
				windowStart = 0
			}
			windowEnd := end + overclaimCMVPProximityWindow
			if windowEnd > len(text) {
				windowEnd = len(text)
			}
			window := text[windowStart:windowEnd]

			if overclaimCMVPReferenceRegex.MatchString(window) {
				// Prohibited phrase has an adjacent CMVP certificate
				// reference — this instance is evidenced, not an overclaim.
				continue
			}

			findings = append(findings, OverclaimFinding{
				File:   path,
				Line:   1 + strings.Count(text[:start], "\n"),
				Phrase: phrase,
			})
		}
	}
	return findings
}

func newFipsOverclaimCheckCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "fips-overclaim-check <path>...",
		Short: "Block affirmative FIPS validated/certified/compliant claims without CMVP evidence",
		Long: `Scan one or more paths (typically the changelog/ directory plus any
*release-note*/*CHANGELOG* file) for affirmative FIPS-validated/certified/
compliant claims.

A prohibited phrase ("FIPS validated", "FIPS certified", "FIPS compliant",
"is FIPS compliant", "FIPS 140-3 validated", "FIPS 140-3 certified", "FIPS
140-2 validated") fails the check unless a CMVP certificate reference
(pattern: CMVP #<number>) appears within ` + fmt.Sprint(overclaimCMVPProximityWindow) + ` characters. Approved,
disclaimer-safe language ("FIPS-aligned", "FIPS-aligned posture", "FIPS
140-3 alignment") always passes.

Examples:
  pipeline fips-overclaim-check changelog/
  pipeline fips-overclaim-check changelog/ CHANGELOG.md CHANGELOG-v1.10-v1.15.md`,
		Args: cobra.MinimumNArgs(1),
		RunE: runFipsOverclaimCheckCmd,
	}

	return cmd
}

func runFipsOverclaimCheckCmd(cmd *cobra.Command, args []string) error {
	cmd.SilenceUsage = true // Don't spam the usage on failure

	res := &OverclaimResult{}
	for _, path := range args {
		pathRes, err := OverclaimCheck(path)
		if err != nil {
			return fmt.Errorf("fips overclaim check: %w", err)
		}
		res.FilesScanned += pathRes.FilesScanned
		res.Findings = append(res.Findings, pathRes.Findings...)
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
			fmt.Printf("%s:%d: prohibited phrase %q found with no adjacent CMVP certificate reference (CMVP #<number> within %d characters)\n",
				f.File, f.Line, f.Phrase, overclaimCMVPProximityWindow)
		}
		fmt.Printf("fips-overclaim-check: scanned %d file(s), %d finding(s)\n", res.FilesScanned, len(res.Findings))
	}

	if !res.Passed() {
		return fmt.Errorf("fips-overclaim-check: found %d FIPS overclaiming violation(s) without CMVP evidence", len(res.Findings))
	}

	return nil
}
