// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package cmd

import (
	"context"
	"fmt"
	"go/token"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"
	"time"

	gh "github.com/google/go-github/v83/github"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// crypto-algorithm-check
// ---------------------------------------------------------------------------

// TestCryptoAlgorithmCheck_Fixtures runs the check against the full fixture
// tree and asserts exactly the expected findings: only the two files with a
// disallowed import and no //fips:exception comment are flagged. The
// excepted import, the approved (crypto/aes) import, the _test.go file with
// a disallowed import, and the vault/testing.go-equivalent fixture must all
// pass cleanly.
func TestCryptoAlgorithmCheck_Fixtures(t *testing.T) {
	res, err := CryptoAlgorithmCheck([]string{"testdata/fips-gate/crypto"})
	require.NoError(t, err)
	require.False(t, res.Passed())
	// disallowed_chacha.go, disallowed_ed25519.go, excepted_import.go, approved_import.go;
	// ignored_test.go (_test.go) and testing.go (vault/testing.go) are excluded from scanning entirely.
	require.Equal(t, 4, res.FilesScanned)

	flagged := map[string]bool{}
	for _, f := range res.Findings {
		flagged[filepath.Base(f.File)] = true
	}
	require.Equal(t, map[string]bool{
		"disallowed_chacha.go":  true,
		"disallowed_ed25519.go": true,
	}, flagged)
	require.Len(t, res.Findings, 2)
}

// TestCryptoAlgorithmCheck_MissingRoot verifies the error_handling
// requirement: a non-existent root produces an empty, passing result and no
// error.
func TestCryptoAlgorithmCheck_MissingRoot(t *testing.T) {
	res, err := CryptoAlgorithmCheck([]string{filepath.Join(t.TempDir(), "does-not-exist")})
	require.NoError(t, err)
	require.True(t, res.Passed())
	require.Equal(t, 0, res.FilesScanned)
}

// TestScanGoFileForCryptoImports_ExceptionComment covers the //fips:exception
// carve-out directly.
func TestScanGoFileForCryptoImports_ExceptionComment(t *testing.T) {
	findings, err := scanGoFileForCryptoImports(token.NewFileSet(), "testdata/fips-gate/crypto/vault/excepted_import.go")
	require.NoError(t, err)
	require.Empty(t, findings)
}

// TestIsCryptoCheckExcludedFile covers the edge_cases exclusions directly:
// test files and vault/testing.go must never be scanned.
func TestIsCryptoCheckExcludedFile(t *testing.T) {
	require.True(t, isCryptoCheckExcludedFile("vault/foo_test.go"))
	require.True(t, isCryptoCheckExcludedFile("vault/testing.go"))
	require.True(t, isCryptoCheckExcludedFile("some/nested/vault/testing.go"))
	require.False(t, isCryptoCheckExcludedFile("vault/keysutil.go"))
	require.False(t, isCryptoCheckExcludedFile("vault/testing_helpers.go"))
}

// ---------------------------------------------------------------------------
// dependency-audit
// ---------------------------------------------------------------------------

// depAuditTestServer builds an httptest-backed *gh.Client along with a mux
// for registering repository responses, following the same pattern used by
// tools/pipeline/internal/pkg/github's own client tests.
func depAuditTestServer(t *testing.T) (*gh.Client, *http.ServeMux) {
	t.Helper()

	mux := http.NewServeMux()
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	client := gh.NewClient(nil)
	u, err := url.Parse(server.URL + "/")
	require.NoError(t, err)
	client.BaseURL = u

	return client, mux
}

func registerDepAuditRepo(mux *http.ServeMux, owner, repo string, archived bool) {
	mux.HandleFunc(fmt.Sprintf("/repos/%s/%s", owner, repo), func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{"archived": %t}`, archived)
	})
}

// TestDependencyAudit_ArchivedDependencyFails covers the primary scenario:
// a go.mod requiring an archived GitHub repository must FAIL, while the
// non-archived GitHub dependency and the non-GitHub dependency in the same
// file must not be flagged or looked up (respectively).
func TestDependencyAudit_ArchivedDependencyFails(t *testing.T) {
	client, mux := depAuditTestServer(t)
	registerDepAuditRepo(mux, "hashicorp", "archived-example", true)
	registerDepAuditRepo(mux, "hashicorp", "go-metrics", false)

	res, err := DependencyAudit(context.Background(), "testdata/fips-gate/dep-audit/go-mod-archived/go.mod", client)
	require.NoError(t, err)
	require.Equal(t, depAuditStatusFail, res.Status)
	require.False(t, res.Passed())
	require.Len(t, res.Findings, 1)
	require.Equal(t, "github.com/hashicorp/archived-example", res.Findings[0].Module)
	require.Equal(t, "hashicorp", res.Findings[0].Owner)
	require.Equal(t, "archived-example", res.Findings[0].Repo)
	require.Equal(t, 2, res.ModulesChecked) // archived-example + go-metrics
	require.Equal(t, 1, res.ModulesSkipped) // golang.org/x/text
}

// TestDependencyAudit_CleanGoModPasses covers the negative case: a go.mod
// with only non-archived and non-GitHub dependencies must PASS.
func TestDependencyAudit_CleanGoModPasses(t *testing.T) {
	client, mux := depAuditTestServer(t)
	registerDepAuditRepo(mux, "hashicorp", "go-metrics", false)

	res, err := DependencyAudit(context.Background(), "testdata/fips-gate/dep-audit/go-mod-clean/go.mod", client)
	require.NoError(t, err)
	require.Equal(t, depAuditStatusPass, res.Status)
	require.True(t, res.Passed())
	require.Empty(t, res.Findings)
	require.Empty(t, res.Warnings)
	require.Equal(t, 1, res.ModulesSkipped)
}

// TestDependencyAudit_RateLimitProducesReview covers the edge_cases
// requirement: a GitHub API rate limit error must never be reported as a
// false PASS -- it must surface as REVIEW with a warning, even though no
// archived dependency was actually found.
func TestDependencyAudit_RateLimitProducesReview(t *testing.T) {
	client, mux := depAuditTestServer(t)
	mux.HandleFunc("/repos/hashicorp/archived-example", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-RateLimit-Limit", "60")
		w.Header().Set("X-RateLimit-Remaining", "0")
		w.Header().Set("X-RateLimit-Reset", fmt.Sprintf("%d", time.Now().Add(time.Hour).Unix()))
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"message": "API rate limit exceeded"}`))
	})
	registerDepAuditRepo(mux, "hashicorp", "go-metrics", false)

	res, err := DependencyAudit(context.Background(), "testdata/fips-gate/dep-audit/go-mod-archived/go.mod", client)
	require.NoError(t, err)
	require.Equal(t, depAuditStatusReview, res.Status)
	require.False(t, res.Passed())
	require.Empty(t, res.Findings)
	// The underlying go-github client caches rate-limit state and preemptively
	// short-circuits subsequent requests once it observes a 403 -- so the
	// go-metrics lookup may also fail locally without a second round-trip.
	// Either way, every failed lookup must be captured as a warning and must
	// never be silently reported as a PASS.
	require.NotEmpty(t, res.Warnings)
	for _, w := range res.Warnings {
		require.Contains(t, w, "rate limit")
	}
}

// TestDependencyAudit_NotFoundIsWarningNotFailure covers a renamed/deleted
// repository: it is not itself evidence the dependency is archived, so it
// must be a warning (REVIEW), not treated as an archived-dependency FAIL.
func TestDependencyAudit_NotFoundIsWarningNotFailure(t *testing.T) {
	client, mux := depAuditTestServer(t)
	mux.HandleFunc("/repos/hashicorp/archived-example", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"message": "Not Found"}`))
	})
	registerDepAuditRepo(mux, "hashicorp", "go-metrics", false)

	res, err := DependencyAudit(context.Background(), "testdata/fips-gate/dep-audit/go-mod-archived/go.mod", client)
	require.NoError(t, err)
	require.Equal(t, depAuditStatusReview, res.Status)
	require.Empty(t, res.Findings)
	require.Len(t, res.Warnings, 1)
	require.Contains(t, res.Warnings[0], "not found")
}

// TestGithubOwnerRepoFromModulePath covers module-path parsing, including
// the edge_cases requirement that non-GitHub-hosted module paths are
// skipped gracefully.
func TestGithubOwnerRepoFromModulePath(t *testing.T) {
	tests := map[string]struct {
		path      string
		wantOwner string
		wantRepo  string
		wantOK    bool
	}{
		"simple github module": {
			path:      "github.com/hashicorp/go-metrics",
			wantOwner: "hashicorp",
			wantRepo:  "go-metrics",
			wantOK:    true,
		},
		"github module with subdirectory": {
			path:      "github.com/hashicorp/vault/api",
			wantOwner: "hashicorp",
			wantRepo:  "vault",
			wantOK:    true,
		},
		"non-github module": {
			path:   "golang.org/x/text",
			wantOK: false,
		},
		"google module": {
			path:   "google.golang.org/grpc",
			wantOK: false,
		},
	}

	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			owner, repo, ok := githubOwnerRepoFromModulePath(tt.path)
			require.Equal(t, tt.wantOK, ok)
			if tt.wantOK {
				require.Equal(t, tt.wantOwner, owner)
				require.Equal(t, tt.wantRepo, repo)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// tls-config-check
// ---------------------------------------------------------------------------

// TestTLSConfigCheck_Fixtures runs the check against the full fixture
// directory and asserts exactly the expected findings: only the weak HCL
// listener and the weak Go tls.Config are flagged; the strong (TLS 1.2)
// equivalents must pass cleanly.
func TestTLSConfigCheck_Fixtures(t *testing.T) {
	res, err := TLSConfigCheck([]string{"testdata/fips-gate/tls"})
	require.NoError(t, err)
	require.False(t, res.Passed())
	require.Equal(t, 4, res.FilesScanned)

	flagged := map[string]bool{}
	for _, f := range res.Findings {
		flagged[filepath.Base(f.File)] = true
	}
	require.Equal(t, map[string]bool{
		"weak-listener.hcl": true,
		"weak_config.go":    true,
	}, flagged)
}

// TestTLSConfigCheck_MissingRoot verifies a non-existent root is skipped
// without error.
func TestTLSConfigCheck_MissingRoot(t *testing.T) {
	res, err := TLSConfigCheck([]string{filepath.Join(t.TempDir(), "does-not-exist")})
	require.NoError(t, err)
	require.True(t, res.Passed())
	require.Equal(t, 0, res.FilesScanned)
}

// TestScanTLSConfigContent covers the regex matching directly for both the
// HCL attribute form and the Go tls package constant form, and confirms
// TLS 1.2/1.3 configurations are never flagged.
func TestScanTLSConfigContent(t *testing.T) {
	tests := map[string]struct {
		content      string
		wantFindings int
	}{
		"hcl 1.0 flagged":          {content: `tls_min_version = "1.0"`, wantFindings: 1},
		"hcl 1.1 single quote":     {content: `tls_min_version = '1.1'`, wantFindings: 1},
		"hcl tls12 passes":         {content: `tls_min_version = "tls12"`, wantFindings: 0},
		"go VersionTLS10 flagged":  {content: `MinVersion: tls.VersionTLS10,`, wantFindings: 1},
		"go VersionTLS12 passes":   {content: `MinVersion: tls.VersionTLS12,`, wantFindings: 0},
		"unrelated content passes": {content: `address = "0.0.0.0:8200"`, wantFindings: 0},
	}

	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			findings := scanTLSConfigContent("x.hcl", []byte(tt.content))
			require.Len(t, findings, tt.wantFindings)
		})
	}
}

// ---------------------------------------------------------------------------
// container-image-check
// ---------------------------------------------------------------------------

// TestContainerImageCheck_Fixtures runs the check against the full fixture
// directory and asserts exactly the expected findings: the FIPS-path Alpine
// image and the FIPS-path (target-name-matched) musl image are flagged; the
// FIPS-path UBI image and the non-FIPS-path Alpine image ("plain") are not.
func TestContainerImageCheck_Fixtures(t *testing.T) {
	res, err := ContainerImageCheck([]string{"testdata/fips-gate/container"})
	require.NoError(t, err)
	require.False(t, res.Passed())
	require.Equal(t, 4, res.DockerfilesScanned)
	require.Equal(t, 3, res.FIPSPathDockerfilesFound) // fips-alpine, fips-ubi, multistage (target-matched); "plain" is not FIPS-path

	flagged := map[string]string{}
	for _, f := range res.Findings {
		flagged[filepath.Base(f.File)] = f.Reason
	}
	require.Len(t, res.Findings, 2)
	require.Contains(t, flagged["Dockerfile.fips-alpine"], "Alpine")
	require.Contains(t, flagged["Dockerfile.multistage"], "musl")
	require.NotContains(t, flagged, "Dockerfile.fips-ubi")
	require.NotContains(t, flagged, "Dockerfile.plain")
}

// TestContainerImageCheck_NonFIPSPathAlpineNotFlagged covers the
// constraints requirement directly: a non-FIPS-path Dockerfile using
// Alpine must never be flagged.
func TestContainerImageCheck_NonFIPSPathAlpineNotFlagged(t *testing.T) {
	res, err := ContainerImageCheck([]string{"testdata/fips-gate/container/Dockerfile.plain"})
	require.NoError(t, err)
	require.True(t, res.Passed())
	require.Equal(t, 1, res.DockerfilesScanned)
	require.Equal(t, 0, res.FIPSPathDockerfilesFound)
}

// TestContainerImageCheck_MultiStageOnlyRelevantStageChecked covers the
// edge_cases requirement: in a multi-stage build where the builder stage
// uses Alpine but only a differently-named final stage is FIPS-path, only
// the FIPS-path stage is checked/flagged -- the builder stage's Alpine use
// must not itself produce a finding.
func TestContainerImageCheck_MultiStageOnlyRelevantStageChecked(t *testing.T) {
	res, err := ContainerImageCheck([]string{"testdata/fips-gate/container/Dockerfile.multistage"})
	require.NoError(t, err)
	require.Len(t, res.Findings, 1)
	require.Equal(t, "ubi-hsm-fips", res.Findings[0].Stage)
	require.Contains(t, res.Findings[0].BaseImage, "musl-base")
}

// TestDisallowedContainerBaseImage covers the base-image classification
// helper directly across common reference shapes.
func TestDisallowedContainerBaseImage(t *testing.T) {
	tests := map[string]struct {
		image string
		want  bool
	}{
		"bare alpine":               {image: "alpine", want: true},
		"tagged alpine":             {image: "alpine:3", want: true},
		"namespaced alpine":         {image: "library/alpine:3.18", want: true},
		"musl in name":              {image: "some-registry.example.com/musl-base:1.0", want: true},
		"ubi passes":                {image: "registry.access.redhat.com/ubi10/ubi-minimal", want: false},
		"ubuntu passes":             {image: "ubuntu:focal", want: false},
		"alpine-flavored word only": {image: "not-actually-alpine-like:1.0", want: false},
	}

	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			_, got := disallowedContainerBaseImage(tt.image)
			require.Equal(t, tt.want, got)
		})
	}
}
