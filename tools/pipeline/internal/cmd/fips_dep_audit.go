// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	gh "github.com/google/go-github/v83/github"
	ghpkg "github.com/hashicorp/vault/tools/pipeline/internal/pkg/github"
	"github.com/spf13/cobra"
	"golang.org/x/mod/modfile"
)

// Dependency-audit status values. FAIL always takes precedence over REVIEW,
// which always takes precedence over PASS -- a repository lookup that
// could not be completed must never be silently reported as a PASS
// (edge_cases: "the check must fail gracefully with a REVIEW status rather
// than a false PASS").
const (
	depAuditStatusPass   = "PASS"
	depAuditStatusFail   = "FAIL"
	depAuditStatusReview = "REVIEW"
)

// DependencyAuditFinding is a go.mod dependency whose GitHub repository has
// been archived.
type DependencyAuditFinding struct {
	Module  string `json:"module"`
	Version string `json:"version"`
	Owner   string `json:"owner"`
	Repo    string `json:"repo"`
}

// DependencyAuditResult is the aggregate outcome of auditing a go.mod
// file's dependencies against the GitHub API for archived-repository
// status.
type DependencyAuditResult struct {
	Status         string                   `json:"status"`
	ModulesChecked int                      `json:"modulesChecked"`
	ModulesSkipped int                      `json:"modulesSkipped"`
	Findings       []DependencyAuditFinding `json:"findings"`
	Warnings       []string                 `json:"warnings,omitempty"`
}

// Passed reports whether the audit found zero archived dependencies and
// completed every repository lookup successfully.
func (r *DependencyAuditResult) Passed() bool {
	return r.Status == depAuditStatusPass
}

// ToJSON renders the result as indented JSON.
func (r *DependencyAuditResult) ToJSON() ([]byte, error) {
	return json.MarshalIndent(r, "", "  ")
}

// DependencyAudit parses the go.mod file at goModPath, extracts every
// required module hosted on github.com, and queries the GitHub API (via
// client) for each repository's archived status.
//
// Non-GitHub dependencies (e.g. golang.org/x/..., google.golang.org/...)
// are skipped gracefully (edge_cases). A dependency that is merely
// unmaintained is never flagged -- only the GitHub-reported archived flag
// is checked (constraints: "must not flag dependencies that are merely
// unmaintained ... only those whose GitHub repository is explicitly
// archived"). If client is nil, an unauthenticated client is constructed
// from GITHUB_TOKEN, which is subject to GitHub's low unauthenticated rate
// limit.
func DependencyAudit(ctx context.Context, goModPath string, client *gh.Client) (*DependencyAuditResult, error) {
	if client == nil {
		var err error
		client, err = ghpkg.NewClient("github.com", os.Getenv("GITHUB_TOKEN"), nil)
		if err != nil {
			return nil, fmt.Errorf("dependency audit: constructing GitHub client: %w", err)
		}
	}

	raw, err := os.ReadFile(goModPath)
	if err != nil {
		return nil, fmt.Errorf("dependency audit: reading %q: %w", goModPath, err)
	}

	parsed, err := modfile.Parse(goModPath, raw, nil)
	if err != nil {
		return nil, fmt.Errorf("dependency audit: parsing %q: %w", goModPath, err)
	}

	result := &DependencyAuditResult{Status: depAuditStatusPass}
	reviewNeeded := false

	for _, req := range parsed.Require {
		if req == nil {
			continue
		}

		owner, repo, ok := githubOwnerRepoFromModulePath(req.Mod.Path)
		if !ok {
			result.ModulesSkipped++
			continue
		}
		result.ModulesChecked++

		ghRepo, _, getErr := client.Repositories.Get(ctx, owner, repo)
		if getErr != nil {
			reviewNeeded = true
			result.Warnings = append(result.Warnings, describeDependencyAuditLookupError(owner, repo, getErr))
			continue
		}

		if ghRepo.GetArchived() {
			result.Findings = append(result.Findings, DependencyAuditFinding{
				Module:  req.Mod.Path,
				Version: req.Mod.Version,
				Owner:   owner,
				Repo:    repo,
			})
		}
	}

	sort.Slice(result.Findings, func(i, j int) bool {
		return result.Findings[i].Module < result.Findings[j].Module
	})

	switch {
	case len(result.Findings) > 0:
		result.Status = depAuditStatusFail
	case reviewNeeded:
		result.Status = depAuditStatusReview
	default:
		result.Status = depAuditStatusPass
	}

	return result, nil
}

// githubOwnerRepoFromModulePath extracts an owner/repo pair from a Go
// module path hosted on github.com. A module path that references a
// subdirectory of a repository (e.g. github.com/hashicorp/vault/api)
// still resolves to the repository root (github.com/hashicorp/vault).
// Non-GitHub-hosted module paths (golang.org/x/..., a private GHE host,
// etc.) return ok=false so the caller can skip them gracefully.
func githubOwnerRepoFromModulePath(path string) (owner, repo string, ok bool) {
	const prefix = "github.com/"
	if !strings.HasPrefix(path, prefix) {
		return "", "", false
	}
	parts := strings.SplitN(strings.TrimPrefix(path, prefix), "/", 3)
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	return parts[0], parts[1], true
}

// describeDependencyAuditLookupError renders a warning message for a
// failed repository lookup, distinguishing GitHub API rate limiting
// (edge_cases) and a plain not-found (a renamed/transferred/deleted
// repository is not itself evidence the dependency is unsafe) from any
// other error.
func describeDependencyAuditLookupError(owner, repo string, err error) string {
	var rateErr *gh.RateLimitError
	var abuseErr *gh.AbuseRateLimitError
	var errResp *gh.ErrorResponse

	switch {
	case errors.As(err, &rateErr):
		return fmt.Sprintf("dependency-audit: GitHub API rate limit exceeded while checking %s/%s; archived status could not be verified: %v", owner, repo, err)
	case errors.As(err, &abuseErr):
		return fmt.Sprintf("dependency-audit: GitHub API secondary rate limit hit while checking %s/%s; archived status could not be verified: %v", owner, repo, err)
	case errors.As(err, &errResp) && errResp.Response != nil && errResp.Response.StatusCode == http.StatusNotFound:
		return fmt.Sprintf("dependency-audit: repository %s/%s not found (renamed, transferred, or deleted); archived status could not be verified", owner, repo)
	default:
		return fmt.Sprintf("dependency-audit: error checking %s/%s: %v", owner, repo, err)
	}
}

func newFipsDepAuditCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "fips-dep-audit [go.mod path]",
		Short: "Block go.mod dependencies whose GitHub repository has been archived",
		Long: `Parse a go.mod file, extract every GitHub-hosted required module, and
query the GitHub API for each repository's archived status. Non-GitHub
dependencies are skipped gracefully. Set GITHUB_TOKEN to avoid GitHub's low
unauthenticated API rate limit.

Examples:
  pipeline fips-dep-audit
  pipeline fips-dep-audit tools/pipeline/internal/cmd/testdata/fips-gate/dep-audit/go-mod-archived/go.mod`,
		Args: cobra.MaximumNArgs(1),
		RunE: runFipsDepAuditCmd,
	}

	return cmd
}

func runFipsDepAuditCmd(cmd *cobra.Command, args []string) error {
	cmd.SilenceUsage = true // Don't spam the usage on failure

	path := "go.mod"
	if rootCfg.repoRoot != "" {
		path = filepath.Join(rootCfg.repoRoot, "go.mod")
	}
	if len(args) == 1 {
		path = args[0]
	}

	res, err := DependencyAudit(cmd.Context(), path, nil)
	if err != nil {
		return fmt.Errorf("dependency audit: %w", err)
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
			fmt.Printf("archived dependency: %s@%s (github.com/%s/%s)\n", f.Module, f.Version, f.Owner, f.Repo)
		}
		for _, w := range res.Warnings {
			fmt.Printf("warning: %s\n", w)
		}
		fmt.Printf("dependency-audit: %s -- checked %d module(s), skipped %d non-GitHub module(s), %d finding(s)\n", res.Status, res.ModulesChecked, res.ModulesSkipped, len(res.Findings))
	}

	switch res.Status {
	case depAuditStatusFail:
		return fmt.Errorf("dependency-audit: found %d archived GitHub dependency/dependencies in %s", len(res.Findings), path)
	case depAuditStatusReview:
		return fmt.Errorf("dependency-audit: %d repository lookup(s) could not be completed; manual REVIEW required (see warnings)", len(res.Warnings))
	}

	return nil
}
