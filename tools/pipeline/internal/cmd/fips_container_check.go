// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package cmd

import (
	"bufio"
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

// dockerfileNameRegex identifies a file as a Dockerfile candidate by name
// (e.g. Dockerfile, Dockerfile.ui, scripts/docker/Dockerfile).
var dockerfileNameRegex = regexp.MustCompile(`(?i)dockerfile`)

// dockerfileFromRegex matches a FROM instruction, capturing the base image
// reference and an optional stage name introduced by AS.
var dockerfileFromRegex = regexp.MustCompile(`(?i)^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?\s*$`)

// dockerfileSkipDirs are directories never walked when discovering
// Dockerfiles from a directory argument.
var dockerfileSkipDirs = map[string]bool{
	".git":         true,
	"vendor":       true,
	"node_modules": true,
}

// dockerfileStage is one `FROM ... [AS name]` instruction found in a
// Dockerfile.
type dockerfileStage struct {
	Name  string
	Image string
	Line  int
}

// ContainerImageFinding is a single FIPS-path Dockerfile stage using a
// disallowed (Alpine or musl-based) base image.
type ContainerImageFinding struct {
	File      string `json:"file"`
	Line      int    `json:"line"`
	Stage     string `json:"stage,omitempty"`
	BaseImage string `json:"baseImage"`
	Reason    string `json:"reason"`
}

// ContainerImageCheckResult is the aggregate outcome of scanning one or
// more Dockerfiles/directories for a FIPS-path musl/Alpine base image
// regression.
type ContainerImageCheckResult struct {
	DockerfilesScanned       int                     `json:"dockerfilesScanned"`
	FIPSPathDockerfilesFound int                     `json:"fipsPathDockerfilesFound"`
	Findings                 []ContainerImageFinding `json:"findings"`
}

// Passed reports whether the scan found zero disallowed FIPS-path base
// images.
func (r *ContainerImageCheckResult) Passed() bool {
	return len(r.Findings) == 0
}

// ToJSON renders the result as indented JSON.
func (r *ContainerImageCheckResult) ToJSON() ([]byte, error) {
	return json.MarshalIndent(r, "", "  ")
}

// ContainerImageCheck examines each path (a Dockerfile, or a directory to
// walk recursively for files whose name contains "dockerfile") and flags
// any FIPS-path build stage using an Alpine or musl-based FROM image.
//
// A Dockerfile is FIPS-path relevant if either: its filename matches
// *fips* (case-insensitive), in which case only the FINAL stage's FROM is
// checked (edge_cases: "only the final stage FROM should be checked"); or
// it has one or more build stages whose name contains "fips" (matching
// this repository's Enterprise `ubi-fips` / `ubi-hsm-fips` build target
// naming convention -- see .github/actions/containerize/action.yml), in
// which case each such stage's own FROM is checked. Dockerfiles and stages
// that match neither rule are never flagged (constraints: "CI/tooling
// images and non-FIPS-path Dockerfiles must not be flagged").
func ContainerImageCheck(paths []string) (*ContainerImageCheckResult, error) {
	result := &ContainerImageCheckResult{}

	var files []string
	for _, p := range paths {
		info, err := os.Stat(p)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, fmt.Errorf("container image check: statting %s: %w", p, err)
		}

		if !info.IsDir() {
			files = append(files, p)
			continue
		}

		walkErr := filepath.WalkDir(p, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				slog.Default().Warn("container image check: unable to walk path", "path", path, "error", err)
				return nil
			}
			if d.IsDir() {
				if dockerfileSkipDirs[d.Name()] {
					return fs.SkipDir
				}
				return nil
			}
			if !dockerfileNameRegex.MatchString(d.Name()) {
				return nil
			}
			files = append(files, path)
			return nil
		})
		if walkErr != nil {
			return nil, fmt.Errorf("container image check: walking %s: %w", p, walkErr)
		}
	}

	for _, f := range files {
		stages, err := parseDockerfileStages(f)
		if err != nil {
			slog.Default().Warn("container image check: unable to parse Dockerfile, skipping", "path", f, "error", err)
			continue
		}
		result.DockerfilesScanned++

		relevant := relevantFIPSPathStages(f, stages)
		if len(relevant) == 0 {
			continue
		}
		result.FIPSPathDockerfilesFound++

		for _, stage := range relevant {
			if reason, disallowed := disallowedContainerBaseImage(stage.Image); disallowed {
				result.Findings = append(result.Findings, ContainerImageFinding{
					File:      f,
					Line:      stage.Line,
					Stage:     stage.Name,
					BaseImage: stage.Image,
					Reason:    reason,
				})
			}
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

// parseDockerfileStages scans a Dockerfile line by line for FROM
// instructions, returning one dockerfileStage per instruction in file
// order.
func parseDockerfileStages(path string) ([]dockerfileStage, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()

	var stages []dockerfileStage
	scanner := bufio.NewScanner(f)
	lineNo := 0
	for scanner.Scan() {
		lineNo++
		m := dockerfileFromRegex.FindStringSubmatch(scanner.Text())
		if m == nil {
			continue
		}
		stages = append(stages, dockerfileStage{Image: m[1], Name: m[2], Line: lineNo})
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return stages, nil
}

// relevantFIPSPathStages returns the subset of stages that are FIPS-path
// relevant for path, deduplicated by line so a stage matched by both the
// filename rule and the stage-name rule is only checked once.
func relevantFIPSPathStages(path string, stages []dockerfileStage) []dockerfileStage {
	seenLines := map[int]bool{}
	var relevant []dockerfileStage
	add := func(s dockerfileStage) {
		if seenLines[s.Line] {
			return
		}
		seenLines[s.Line] = true
		relevant = append(relevant, s)
	}

	if len(stages) > 0 && strings.Contains(strings.ToLower(filepath.Base(path)), "fips") {
		add(stages[len(stages)-1])
	}

	for _, s := range stages {
		if s.Name != "" && strings.Contains(strings.ToLower(s.Name), "fips") {
			add(s)
		}
	}

	return relevant
}

// disallowedContainerBaseImage reports whether image is an Alpine or
// musl-based base image, and if so, why.
func disallowedContainerBaseImage(image string) (string, bool) {
	lower := strings.ToLower(image)

	if strings.Contains(lower, "musl") {
		return fmt.Sprintf("FIPS-path Dockerfile stage uses a musl-based image %q; musl-libc does not reliably support the OpenSSL FIPS provider self-test, use a glibc-based image (e.g. UBI) instead", image), true
	}

	ref := lower
	if idx := strings.LastIndex(ref, "/"); idx != -1 {
		ref = ref[idx+1:]
	}
	name := ref
	if idx := strings.IndexAny(ref, ":@"); idx != -1 {
		name = ref[:idx]
	}
	if name == "alpine" {
		return fmt.Sprintf("FIPS-path Dockerfile stage uses an Alpine base image %q; Alpine's musl-libc does not reliably support the OpenSSL FIPS provider self-test, use a glibc-based image (e.g. UBI) instead", image), true
	}

	return "", false
}

func newFipsContainerCheckCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "fips-container-check [paths]...",
		Short: "Block a musl/Alpine base image on a FIPS-path Dockerfile",
		Long: `Scan the repository (or explicit Dockerfile/directory arguments) for a
Dockerfile used for FIPS-path builds -- identified by a *fips* filename or
a build stage named/containing "fips" -- that uses FROM alpine or a
musl-based base image.

Examples:
  pipeline fips-container-check
  pipeline fips-container-check Dockerfile
  pipeline fips-container-check tools/pipeline/internal/cmd/testdata/fips-gate/container`,
		RunE: runFipsContainerCheckCmd,
	}

	return cmd
}

func runFipsContainerCheckCmd(cmd *cobra.Command, args []string) error {
	cmd.SilenceUsage = true // Don't spam the usage on failure

	roots := args
	if len(roots) == 0 {
		root := "."
		if rootCfg.repoRoot != "" {
			root = rootCfg.repoRoot
		}
		roots = []string{root}
	}

	res, err := ContainerImageCheck(roots)
	if err != nil {
		return fmt.Errorf("container image check: %w", err)
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
			stage := f.Stage
			if stage == "" {
				stage = "(final stage)"
			}
			fmt.Printf("%s:%d: FIPS-path stage %q uses disallowed base image %q\n", f.File, f.Line, stage, f.BaseImage)
		}
		fmt.Printf("container-image-check: scanned %d Dockerfile(s), %d FIPS-path Dockerfile(s), %d finding(s)\n", res.DockerfilesScanned, res.FIPSPathDockerfilesFound, len(res.Findings))
	}

	if !res.Passed() {
		return fmt.Errorf("container-image-check: found %d FIPS-path Dockerfile stage(s) using a disallowed musl/Alpine base image", len(res.Findings))
	}

	return nil
}
