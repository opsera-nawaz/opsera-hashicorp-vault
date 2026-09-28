// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	git "github.com/hashicorp/vault/tools/pipeline/internal/pkg/git/client"
	"github.com/spf13/cobra"
)

var generateProvenanceReq = &GenerateProvenanceReq{}

var (
	provenanceRepoFlag      string
	provenanceGoVersionFlag string
	provenanceBinaryFlag    string
	provenanceBuildFlags    []string
	provenanceBuilderIDFlag string
)

func newSbomProvenanceCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "provenance",
		Short: "Generate a build provenance attestation",
		Long: `Generate an in-toto/SLSA-shaped build provenance attestation linking the
source commit SHA, Go toolchain version, build flags, and resulting binary
artifact SHA256. Contains no secret values.

Examples:
  pipeline sbom provenance \
    --binary dist/vault \
    --build-flag "-X github.com/hashicorp/vault/version.GitCommit=$(git rev-parse HEAD)" \
    --output .release/provenance/1.2.3-provenance.json`,
		RunE: runSbomProvenanceCmd,
	}

	cmd.Flags().StringVar(&provenanceRepoFlag, "repo", "", "Source repository (default: resolved from 'git remote get-url origin')")
	cmd.Flags().StringVar(&provenanceGoVersionFlag, "go-version-file", "", "Path to .go-version (default: <repo-root>/.go-version)")
	cmd.Flags().StringVar(&provenanceBinaryFlag, "binary", "", "Path to the built binary artifact to hash (default: <repo-root>/dist/vault)")
	cmd.Flags().StringArrayVar(&provenanceBuildFlags, "build-flag", nil, "Repeatable. A build flag/ldflag used to produce the binary")
	cmd.Flags().StringVar(&provenanceBuilderIDFlag, "builder-id", "", `Identifier for the system that produced the binary (default: the GitHub Actions run URL when GITHUB_* env vars are set, else "local-manual-build")`)
	cmd.Flags().StringVar(&generateProvenanceReq.OutputPath, "output", "", "Path to write the provenance attestation JSON to (required)")

	return cmd
}

func runSbomProvenanceCmd(cmd *cobra.Command, args []string) error {
	cmd.SilenceUsage = true
	ctx := cmd.Context()

	if generateProvenanceReq.OutputPath == "" {
		return fmt.Errorf("generate provenance: --output is required")
	}

	repo := provenanceRepoFlag
	if repo == "" {
		remoteRes, err := rootCfg.git.Remote(ctx, &git.RemoteOpts{Command: git.RemoteCommandGetURL, Name: "origin"})
		if err != nil {
			return fmt.Errorf("generate provenance: resolving --repo from git remote origin: %w", err)
		}
		repo = normalizeRepoURL(strings.TrimSpace(string(remoteRes.Stdout)))
	}
	generateProvenanceReq.SourceRepo = repo

	goVersionPath := provenanceGoVersionFlag
	if goVersionPath == "" {
		goVersionPath = filepath.Join(rootCfg.repoRoot, ".go-version")
	}
	generateProvenanceReq.GoVersionPath = goVersionPath

	binaryPath := provenanceBinaryFlag
	if binaryPath == "" {
		binaryPath = filepath.Join(rootCfg.repoRoot, "dist", "vault")
	}
	generateProvenanceReq.BinaryPath = binaryPath
	generateProvenanceReq.BuildFlags = provenanceBuildFlags

	builderID := provenanceBuilderIDFlag
	if builderID == "" {
		builderID = defaultBuilderID()
	}
	generateProvenanceReq.BuilderID = builderID

	res, err := GenerateProvenance(ctx, generateProvenanceReq)
	if err != nil {
		return fmt.Errorf("generating provenance: %w", err)
	}

	switch rootCfg.format {
	case "json":
		b, jsonErr := json.MarshalIndent(res.Attestation, "", "  ")
		if jsonErr != nil {
			return jsonErr
		}
		fmt.Println(string(b))
	default:
		p := res.Attestation.Predicate
		fmt.Printf("Provenance attestation written to %s\n", res.OutputPath)
		fmt.Printf("  source_commit_sha:      %s\n", p.SourceCommitSHA)
		fmt.Printf("  source_repo:            %s\n", p.SourceRepo)
		fmt.Printf("  go_toolchain_version:   %s\n", p.GoToolchainVersion)
		fmt.Printf("  binary_artifact_sha256: %s\n", p.BinaryArtifactSHA256)
		fmt.Printf("  builder_id:             %s\n", p.BuilderID)
		if p.Warning != "" {
			fmt.Printf("  warning: %s\n", p.Warning)
		}
		if p.ErrorDetail != "" {
			fmt.Printf("  error_detail: %s\n", p.ErrorDetail)
		}
	}

	return nil
}

// normalizeRepoURL converts an https or ssh git remote URL into a bare
// "host/org/repo" form, e.g. "git@github.com:org/repo.git" and
// "https://github.com/org/repo.git" both become "github.com/org/repo".
func normalizeRepoURL(url string) string {
	url = strings.TrimSuffix(url, ".git")
	url = strings.TrimPrefix(url, "https://")
	url = strings.TrimPrefix(url, "http://")
	if strings.HasPrefix(url, "git@") {
		url = strings.TrimPrefix(url, "git@")
		url = strings.Replace(url, ":", "/", 1)
	}
	return url
}

// defaultBuilderID identifies the system that produced the binary. In
// GitHub Actions this resolves to the run URL; outside of CI it falls back
// to a fixed sentinel rather than fabricating an identity.
func defaultBuilderID() string {
	serverURL := os.Getenv("GITHUB_SERVER_URL")
	repo := os.Getenv("GITHUB_REPOSITORY")
	runID := os.Getenv("GITHUB_RUN_ID")
	if serverURL != "" && repo != "" && runID != "" {
		return fmt.Sprintf("%s/%s/actions/runs/%s", serverURL, repo, runID)
	}
	return "local-manual-build"
}
