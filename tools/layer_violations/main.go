// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: BUSL-1.1

// Command layer_violations counts direct mux.Handle / mux.HandleFunc call
// sites that bypass the HandlerRegistry authorization boundary (see
// http/handler_registry.go), and writes the result to
// tests/fixtures/layer_violation_baseline.json.
//
// Background: the project's architecture artifact documents a pre-refactor
// baseline of "1,191 handler-layer violations where config-layer handlers
// bypass the HandleRequest -> CheckToken authorization pipeline" - the
// motivating metric for the handler registry work (WO-002, WO-013, WO-014,
// WO-024). That figure predates this worktree: WO-024 (already landed on
// main - see `git log --oneline | grep WO-024`) migrated every remaining
// mux.Handle call in http/handler.go's default case to registry.Register,
// so re-running the same counting method against the current tree no
// longer reproduces 1,191. This tool re-measures the count as it exists
// today, using the architecture artifact's own definition ("direct
// mux.Handle/mux.HandleFunc calls outside the HandlerRegistry"), so future
// PRs have a real, reproducible floor to assert against - re-recording a
// stale historical figure would make the "never increases" check in AC8
// meaningless, since every PR would trivially satisfy "less than 1,191".
//
// Usage:
//
//	go run ./tools/layer_violations > tests/fixtures/layer_violation_baseline.json
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// violationPattern matches a direct mux.Handle(...) or mux.HandleFunc(...)
// call. It intentionally does not match comments (callers filter those with
// isCommentLine) or _test.go files (filtered by the walk itself), since
// neither is a live registration that bypasses the authorization pipeline.
var violationPattern = regexp.MustCompile(`\bmux\.(Handle|HandleFunc)\(`)

// excludeDirs skips vendor trees and the tool's own build artifacts so the
// scan stays scoped to first-party Vault source, matching how `go build
// ./...` itself would see the module.
var excludeDirs = map[string]bool{
	"vendor":       true,
	".git":         true,
	"node_modules": true,
	"ui":           true, // Ember app; no Go mux registrations live here
	"tools":        true, // this tool's own source text matches its own pattern literal; tooling isn't part of the handler-layer surface being measured
}

// knownExclusions documents call sites this tool's grep-equivalent pattern
// matches but which are not authorization-boundary violations in the
// http/handler.go sense the architecture artifact defines, with the reason
// each is out of scope. Keeping this as data (not a silent skip) means a
// reviewer can see exactly what was excluded and why, rather than
// wondering why the count doesn't match a raw grep.
type exclusion struct {
	file   string
	reason string
}

var knownExclusions = []exclusion{
	{
		file:   "http/handler_registry.go",
		reason: "HandlerRegistry.mountLocked's own mux.Handle call is the registry's internal mounting mechanism, not a call that bypasses it - every registration it mounts already carries explicit AuthRequired/AuditRequired/FIPSSensitive metadata and flows through the same middleware chain Build() applies.",
	},
}

type violation struct {
	File string `json:"file"`
	Line int    `json:"line"`
	Text string `json:"text"`
}

type fileBreakdown struct {
	File  string `json:"file"`
	Count int    `json:"count"`
}

type baseline struct {
	SchemaVersion       int             `json:"schema_version"`
	GeneratedBy         string          `json:"generated_by"`
	Methodology         string          `json:"methodology"`
	HistoricalBaseline  historicalNote  `json:"historical_baseline"`
	CurrentBaseline     int             `json:"current_baseline"`
	CurrentByFile       []fileBreakdown `json:"current_by_file"`
	Violations          []violation     `json:"violations"`
	Exclusions          []exclusion2    `json:"exclusions"`
	MonotonicConstraint string          `json:"monotonic_constraint"`
}

type exclusion2 struct {
	File   string `json:"file"`
	Reason string `json:"reason"`
}

type historicalNote struct {
	Count int    `json:"count"`
	Note  string `json:"note"`
}

func main() {
	root, err := repoRoot()
	if err != nil {
		fmt.Fprintf(os.Stderr, "layer_violations: %v\n", err)
		os.Exit(1)
	}

	var violations []violation
	excludedFiles := make(map[string]bool, len(knownExclusions))
	for _, ex := range knownExclusions {
		excludedFiles[ex.file] = true
	}

	err = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if excludeDirs[info.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if excludedFiles[rel] {
			return nil
		}

		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()

		scanner := bufio.NewScanner(f)
		lineNo := 0
		for scanner.Scan() {
			lineNo++
			line := scanner.Text()
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "//") {
				continue
			}
			if violationPattern.MatchString(line) {
				violations = append(violations, violation{
					File: rel,
					Line: lineNo,
					Text: trimmed,
				})
			}
		}
		return scanner.Err()
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "layer_violations: walking repo: %v\n", err)
		os.Exit(1)
	}

	sort.Slice(violations, func(i, j int) bool {
		if violations[i].File != violations[j].File {
			return violations[i].File < violations[j].File
		}
		return violations[i].Line < violations[j].Line
	})

	counts := map[string]int{}
	for _, v := range violations {
		counts[v.File]++
	}
	var byFile []fileBreakdown
	for f, c := range counts {
		byFile = append(byFile, fileBreakdown{File: f, Count: c})
	}
	sort.Slice(byFile, func(i, j int) bool { return byFile[i].File < byFile[j].File })

	exclusions := make([]exclusion2, 0, len(knownExclusions))
	for _, ex := range knownExclusions {
		exclusions = append(exclusions, exclusion2{File: ex.file, Reason: ex.reason})
	}

	out := baseline{
		SchemaVersion: 1,
		GeneratedBy:   "tools/layer_violations (go run ./tools/layer_violations, or `make layer-violations`)",
		Methodology:   "Counts non-comment, non-test-file call sites matching `mux.Handle(` or `mux.HandleFunc(` across the repository (vendor/, .git/, node_modules/, ui/ excluded), per the architecture artifact's definition of a handler-layer violation: a config-layer handler registered outside the HandlerRegistry, bypassing the HandleRequest -> CheckToken authorization pipeline.",
		HistoricalBaseline: historicalNote{
			Count: 1191,
			Note:  "Pre-refactor figure from the project architecture artifact (Trust Boundaries ForgeScore section), measured before WO-002/013/014/024 introduced and migrated handlers onto HandlerRegistry. It is recorded here for traceability only; WO-024 already landed on main in this worktree (see `git log --oneline` for the WO-024 and WO-025 merge commits), so re-running this tool's methodology against the current tree does not reproduce 1,191. CurrentBaseline below is the real, reproducible floor for this worktree's monotonic-decrease check.",
		},
		CurrentBaseline:     len(violations),
		CurrentByFile:       byFile,
		Violations:          violations,
		Exclusions:          exclusions,
		MonotonicConstraint: "CurrentBaseline must not increase in any subsequent PR touching http/, vault/, or command/ (Vault Agent/Proxy also register their own mux directly). Regenerate via `make layer-violations` and diff CurrentBaseline against this committed file's value; fail CI if the new value is greater.",
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(out); err != nil {
		fmt.Fprintf(os.Stderr, "layer_violations: encoding JSON: %v\n", err)
		os.Exit(1)
	}
}

// repoRoot walks up from the current working directory to find the Vault
// repository root (identified by go.mod declaring module
// github.com/hashicorp/vault), so this tool works whether invoked via `go
// run ./tools/layer_violations` from the repo root or from elsewhere.
func repoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		data, err := os.ReadFile(filepath.Join(dir, "go.mod"))
		if err == nil && strings.Contains(string(data), "module github.com/hashicorp/vault\n") {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("could not locate repository root (go.mod for github.com/hashicorp/vault) above %s", dir)
		}
		dir = parent
	}
}
