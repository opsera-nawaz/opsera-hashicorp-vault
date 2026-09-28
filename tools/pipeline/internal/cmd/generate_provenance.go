// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package cmd

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	git "github.com/hashicorp/vault/tools/pipeline/internal/pkg/git/client"
)

// ProvenanceSubject identifies the artifact the attestation is about, using
// the in-toto Statement "subject" shape (name + digest set).
type ProvenanceSubject struct {
	Name   string            `json:"name"`
	Digest map[string]string `json:"digest"`
}

// ProvenancePredicate carries the build-provenance facts required by the AC:
// source_commit_sha, source_repo, go_toolchain_version, build_flags,
// binary_artifact_sha256, build_timestamp, and builder_id.
type ProvenancePredicate struct {
	SourceCommitSHA      string   `json:"source_commit_sha"`
	SourceRepo           string   `json:"source_repo"`
	GoToolchainVersion   string   `json:"go_toolchain_version"`
	BuildFlags           []string `json:"build_flags"`
	BinaryArtifactSHA256 string   `json:"binary_artifact_sha256"`
	BuildTimestamp       string   `json:"build_timestamp"`
	BuilderID            string   `json:"builder_id"`
	// Warning is set when the commit SHA could not be resolved with full
	// confidence (e.g. a shallow clone) but a usable ref was still found.
	Warning string `json:"warning,omitempty"`
	// ErrorDetail is set when BinaryArtifactSHA256 is "UNAVAILABLE".
	ErrorDetail string `json:"error_detail,omitempty"`
}

// ProvenanceAttestation is the on-disk provenance document. It follows the
// in-toto Statement/SLSA Provenance shape (_type, predicateType, subject,
// predicate) for future SLSA compatibility; full SLSA signing/envelope
// wrapping is out of scope for this story.
type ProvenanceAttestation struct {
	Type          string              `json:"_type"`
	PredicateType string              `json:"predicateType"`
	Subject       []ProvenanceSubject `json:"subject"`
	Predicate     ProvenancePredicate `json:"predicate"`
}

// CommitResolver resolves the source commit SHA for the current build, along
// with whether the resolution happened against a shallow clone. It is
// injectable so tests can supply a mock git rev-parse output instead of
// shelling out to a real git binary (AC: "verified by a unit test that
// compares the field against a mock git rev-parse output").
type CommitResolver func(ctx context.Context) (sha string, shallow bool, err error)

// GenerateProvenanceReq is the input to GenerateProvenance.
type GenerateProvenanceReq struct {
	// SourceRepo is the repository the source was built from (e.g.
	// "github.com/hashicorp/vault"), typically resolved by the caller from
	// `git remote get-url origin`.
	SourceRepo string
	// GoVersionPath is the path to the repo's .go-version file. The full
	// contents (including any boringcrypto-style suffix, e.g. "1.27.1b7")
	// are captured verbatim per edge_cases.
	GoVersionPath string
	// BinaryPath is the path to the built binary artifact to hash. If it
	// cannot be read, BinaryArtifactSHA256 is set to "UNAVAILABLE" and
	// ErrorDetail explains why, per error_handling -- this is not a fatal
	// error for the overall provenance generation.
	BinaryPath string
	BuildFlags []string
	BuilderID  string
	OutputPath string

	// Resolver resolves the source commit SHA. Defaults to a real `git
	// rev-parse` invocation via tools/pipeline/internal/pkg/git/client when
	// nil.
	Resolver CommitResolver
	// Now returns the current time. Defaults to time.Now when nil.
	Now func() time.Time
}

// GenerateProvenanceRes is the result of a successful GenerateProvenance call.
type GenerateProvenanceRes struct {
	OutputPath  string
	Attestation *ProvenanceAttestation
}

// GenerateProvenance builds and writes a build-provenance attestation
// linking the source commit, Go toolchain version, build flags, and
// resulting binary artifact SHA256. It never embeds secret values (tokens,
// keys, credentials) -- only the fields listed above.
func GenerateProvenance(ctx context.Context, req *GenerateProvenanceReq) (*GenerateProvenanceRes, error) {
	if req == nil || req.SourceRepo == "" {
		return nil, errors.New("generate provenance: source repo is required")
	}
	if req.OutputPath == "" {
		return nil, errors.New("generate provenance: output path is required")
	}

	resolver := req.Resolver
	if resolver == nil {
		resolver = defaultCommitResolver()
	}

	sha, shallow, err := resolver(ctx)
	if err != nil {
		return nil, fmt.Errorf("generate provenance: resolving source commit sha: %w", err)
	}

	predicate := ProvenancePredicate{
		SourceCommitSHA: sha,
		SourceRepo:      req.SourceRepo,
		BuildFlags:      req.BuildFlags,
		BuilderID:       req.BuilderID,
	}
	if shallow {
		predicate.Warning = "repository is a shallow clone; source_commit_sha reflects the available ref rather than a fully verified history"
	}

	goVersion, err := readGoVersion(req.GoVersionPath)
	if err != nil {
		return nil, fmt.Errorf("generate provenance: reading go toolchain version: %w", err)
	}
	predicate.GoToolchainVersion = goVersion

	now := req.Now
	if now == nil {
		now = time.Now
	}
	predicate.BuildTimestamp = now().UTC().Format(time.RFC3339)

	sum, sumErr := sha256File(req.BinaryPath)
	if sumErr != nil {
		predicate.BinaryArtifactSHA256 = "UNAVAILABLE"
		predicate.ErrorDetail = sumErr.Error()
	} else {
		predicate.BinaryArtifactSHA256 = sum
	}

	attestation := &ProvenanceAttestation{
		Type:          "https://in-toto.io/Statement/v1",
		PredicateType: "https://slsa.dev/provenance/v1",
		Subject: []ProvenanceSubject{
			{
				Name:   filepath.Base(req.BinaryPath),
				Digest: map[string]string{"sha256": predicate.BinaryArtifactSHA256},
			},
		},
		Predicate: predicate,
	}

	out, err := json.MarshalIndent(attestation, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("generate provenance: marshaling attestation: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(req.OutputPath), 0o755); err != nil {
		return nil, fmt.Errorf("generate provenance: creating output directory for %q: %w", req.OutputPath, err)
	}
	if err := os.WriteFile(req.OutputPath, out, 0o644); err != nil {
		return nil, fmt.Errorf("generate provenance: writing attestation to %q: %w", req.OutputPath, err)
	}

	return &GenerateProvenanceRes{OutputPath: req.OutputPath, Attestation: attestation}, nil
}

// defaultCommitResolver resolves the source commit SHA using the local git
// binary via tools/pipeline/internal/pkg/git/client -- the same client used
// elsewhere in this CLI (see root.go's use of git.Client.RevParse). Unlike
// the GitHub-API-based retry/resolution in
// tools/pipeline/internal/pkg/github/collect_artifact_shas.go (which maps
// merged release PRs to their merge-commit SHA via the GitHub API), this
// provenance use case runs locally at build time and only needs the current
// HEAD, so it reuses the local git.Client primitive rather than the GitHub
// API client.
func defaultCommitResolver() CommitResolver {
	return func(ctx context.Context) (string, bool, error) {
		c := git.NewClient()

		headRes, err := c.RevParse(ctx, &git.RevParseOpts{Args: []string{"HEAD"}})
		if err != nil {
			return "", false, fmt.Errorf("git rev-parse HEAD: %w", err)
		}
		sha := strings.TrimSpace(string(headRes.Stdout))
		if sha == "" {
			return "", false, errors.New("git rev-parse HEAD returned an empty commit sha")
		}

		shallow := false
		shallowRes, shallowErr := c.RevParse(ctx, &git.RevParseOpts{IsShallowRepository: true})
		if shallowErr == nil {
			shallow = strings.TrimSpace(string(shallowRes.Stdout)) == "true"
		}

		return sha, shallow, nil
	}
}

// readGoVersion returns the trimmed, verbatim contents of the .go-version
// file, preserving any toolchain suffix (e.g. the boringcrypto suffix in
// "1.27.1b7") per edge_cases.
func readGoVersion(path string) (string, error) {
	if path == "" {
		return "", errors.New("go-version path is required")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("reading %q: %w", path, err)
	}
	return strings.TrimSpace(string(raw)), nil
}

// sha256File computes the hex-encoded SHA256 digest of the file at path.
func sha256File(path string) (string, error) {
	if path == "" {
		return "", errors.New("binary path is required")
	}
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("opening %q: %w", path, err)
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", fmt.Errorf("hashing %q: %w", path, err)
	}

	return hex.EncodeToString(h.Sum(nil)), nil
}
