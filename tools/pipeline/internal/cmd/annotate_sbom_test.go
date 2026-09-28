// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package cmd

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestAnnotateSBOM_SuccessfulMerge verifies that annotating a real base SBOM
// with the fixture crypto inventory produces exactly the expected annotated
// document (testdata/sbom/expected-annotated-sbom.json), without mutating
// any existing base SBOM field.
func TestAnnotateSBOM_SuccessfulMerge(t *testing.T) {
	outPath := filepath.Join(t.TempDir(), "annotated.json")

	res, err := AnnotateSBOM(&AnnotateSBOMReq{
		SBOMPath:      filepath.Join("testdata", "sbom", "base-sbom.json"),
		InventoryPath: filepath.Join("testdata", "sbom", "crypto-inventory.json"),
		OutputPath:    outPath,
	})
	require.NoError(t, err)
	require.Equal(t, 12, res.AnnotationCount)
	require.Empty(t, res.Warnings)

	got, err := os.ReadFile(outPath)
	require.NoError(t, err)
	want, err := os.ReadFile(filepath.Join("testdata", "sbom", "expected-annotated-sbom.json"))
	require.NoError(t, err)

	var gotJSON, wantJSON map[string]any
	require.NoError(t, json.Unmarshal(got, &gotJSON))
	require.NoError(t, json.Unmarshal(want, &wantJSON))
	require.Equal(t, wantJSON, gotJSON)
}

// TestAnnotateSBOM_AnnotationsCoverRequiredPackages verifies that every
// package the acceptance criteria requires at minimum is present in the
// crypto_annotations array with a non-empty algorithms_used list.
func TestAnnotateSBOM_AnnotationsCoverRequiredPackages(t *testing.T) {
	required := []string{
		"crypto/aes",
		"crypto/ecdsa",
		"crypto/ed25519",
		"crypto/hmac",
		"crypto/rand",
		"crypto/rsa",
		"crypto/sha256",
		"golang.org/x/crypto/chacha20poly1305",
		"golang.org/x/crypto/ed25519",
		"golang.org/x/crypto/hkdf",
		"github.com/tink-crypto/tink-go/v2",
	}

	outPath := filepath.Join(t.TempDir(), "annotated.json")
	_, err := AnnotateSBOM(&AnnotateSBOMReq{
		SBOMPath:      filepath.Join("testdata", "sbom", "base-sbom.json"),
		InventoryPath: filepath.Join("testdata", "sbom", "crypto-inventory.json"),
		OutputPath:    outPath,
	})
	require.NoError(t, err)

	raw, err := os.ReadFile(outPath)
	require.NoError(t, err)
	var doc struct {
		CryptoAnnotations []CryptoAnnotation `json:"crypto_annotations"`
	}
	require.NoError(t, json.Unmarshal(raw, &doc))

	seen := make(map[string]CryptoAnnotation, len(doc.CryptoAnnotations))
	for _, a := range doc.CryptoAnnotations {
		seen[a.PackageName] = a
	}

	for _, pkg := range required {
		a, ok := seen[pkg]
		require.True(t, ok, "expected an annotation for %s", pkg)
		require.NotEmpty(t, a.AlgorithmsUsed, "%s must list algorithms_used", pkg)
		require.True(t, a.FoundInSBOM, "%s should resolve against the base sbom components", pkg)
	}
}

// TestAnnotateSBOM_PackageNotInBaseSBOM covers the edge case where the
// crypto inventory references a package absent from the base SBOM: the
// annotation must still be included, flagged found_in_sbom=false.
func TestAnnotateSBOM_PackageNotInBaseSBOM(t *testing.T) {
	outPath := filepath.Join(t.TempDir(), "annotated.json")
	_, err := AnnotateSBOM(&AnnotateSBOMReq{
		SBOMPath:      filepath.Join("testdata", "sbom", "base-sbom.json"),
		InventoryPath: filepath.Join("testdata", "sbom", "crypto-inventory.json"),
		OutputPath:    outPath,
	})
	require.NoError(t, err)

	raw, err := os.ReadFile(outPath)
	require.NoError(t, err)
	var doc struct {
		CryptoAnnotations []CryptoAnnotation `json:"crypto_annotations"`
	}
	require.NoError(t, json.Unmarshal(raw, &doc))

	var found bool
	for _, a := range doc.CryptoAnnotations {
		if a.PackageName == "github.com/example/not-in-base-sbom" {
			found = true
			require.False(t, a.FoundInSBOM)
		}
	}
	require.True(t, found, "fixture inventory should still contain the not-in-sbom entry")
}

// TestAnnotateSBOM_MissingInventoryFile_ProducesWarningNotError verifies
// error_handling: a missing crypto inventory file is not fatal -- the base
// SBOM is written through unchanged with a warning.
func TestAnnotateSBOM_MissingInventoryFile_ProducesWarningNotError(t *testing.T) {
	tmpDir := t.TempDir()
	outPath := filepath.Join(tmpDir, "annotated.json")

	res, err := AnnotateSBOM(&AnnotateSBOMReq{
		SBOMPath:      filepath.Join("testdata", "sbom", "base-sbom.json"),
		InventoryPath: filepath.Join(tmpDir, "does-not-exist.json"),
		OutputPath:    outPath,
	})
	require.NoError(t, err)
	require.Equal(t, 0, res.AnnotationCount)
	require.Len(t, res.Warnings, 1)
	require.Contains(t, res.Warnings[0], "not found")

	raw, err := os.ReadFile(outPath)
	require.NoError(t, err)
	var doc map[string]any
	require.NoError(t, json.Unmarshal(raw, &doc))

	annotations, ok := doc["crypto_annotations"].([]any)
	require.True(t, ok)
	require.Empty(t, annotations)
	require.Equal(t, "CycloneDX", doc["bomFormat"])
}

// TestAnnotateSBOM_EmptyInventory_ProducesEmptyAnnotationsWithWarning covers
// the "empty inventory handling" test case called out by testing_strategy.
func TestAnnotateSBOM_EmptyInventory_ProducesEmptyAnnotationsWithWarning(t *testing.T) {
	tmpDir := t.TempDir()
	emptyInventory := filepath.Join(tmpDir, "empty-inventory.json")
	require.NoError(t, os.WriteFile(emptyInventory, []byte(`{"schema_version":1,"generated_from":[],"entries":[]}`), 0o644))

	outPath := filepath.Join(tmpDir, "annotated.json")
	res, err := AnnotateSBOM(&AnnotateSBOMReq{
		SBOMPath:      filepath.Join("testdata", "sbom", "base-sbom.json"),
		InventoryPath: emptyInventory,
		OutputPath:    outPath,
	})
	require.NoError(t, err)
	require.Equal(t, 0, res.AnnotationCount)
	require.Len(t, res.Warnings, 1)
	require.Contains(t, res.Warnings[0], "zero entries")
}

// TestAnnotateSBOM_MalformedBaseSBOM_ReturnsError covers the edge case:
// "Base SBOM is empty or malformed JSON -- annotator must exit with a clear
// error message identifying the parsing failure location."
func TestAnnotateSBOM_MalformedBaseSBOM_ReturnsError(t *testing.T) {
	tmpDir := t.TempDir()
	malformed := filepath.Join(tmpDir, "malformed.json")
	require.NoError(t, os.WriteFile(malformed, []byte(`{not valid json`), 0o644))

	_, err := AnnotateSBOM(&AnnotateSBOMReq{
		SBOMPath:      malformed,
		InventoryPath: filepath.Join("testdata", "sbom", "crypto-inventory.json"),
		OutputPath:    filepath.Join(tmpDir, "out.json"),
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "not valid JSON")
	require.Contains(t, err.Error(), malformed)
}

func TestAnnotateSBOM_EmptyBaseSBOM_ReturnsError(t *testing.T) {
	tmpDir := t.TempDir()
	empty := filepath.Join(tmpDir, "empty.json")
	require.NoError(t, os.WriteFile(empty, []byte(``), 0o644))

	_, err := AnnotateSBOM(&AnnotateSBOMReq{
		SBOMPath:   empty,
		OutputPath: filepath.Join(tmpDir, "out.json"),
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), empty)
}

func TestAnnotateSBOM_MissingBaseSBOM_ReturnsError(t *testing.T) {
	tmpDir := t.TempDir()
	_, err := AnnotateSBOM(&AnnotateSBOMReq{
		SBOMPath:   filepath.Join(tmpDir, "does-not-exist.json"),
		OutputPath: filepath.Join(tmpDir, "out.json"),
	})
	require.Error(t, err)
}

func TestAnnotateSBOM_RequiresSBOMAndOutputPath(t *testing.T) {
	_, err := AnnotateSBOM(&AnnotateSBOMReq{})
	require.Error(t, err)

	_, err = AnnotateSBOM(&AnnotateSBOMReq{SBOMPath: filepath.Join("testdata", "sbom", "base-sbom.json")})
	require.Error(t, err)
}

// TestGenerateProvenance_FieldPopulationAgainstMockGitRevParse is the AC #5
// unit test: it verifies source_commit_sha (and the other required
// predicate fields) against a mocked git rev-parse output rather than
// shelling out to a real git binary.
func TestGenerateProvenance_FieldPopulationAgainstMockGitRevParse(t *testing.T) {
	tmpDir := t.TempDir()
	goVersionPath := filepath.Join(tmpDir, ".go-version")
	require.NoError(t, os.WriteFile(goVersionPath, []byte("1.27.1b7\n"), 0o644))

	binaryPath := filepath.Join(tmpDir, "vault-binary")
	require.NoError(t, os.WriteFile(binaryPath, []byte("fake-binary-contents"), 0o755))

	const mockRevParseSHA = "deadbeefcafefeed0123456789abcdef01234567"
	fixedTime := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)

	outPath := filepath.Join(tmpDir, "provenance.json")
	res, err := GenerateProvenance(context.Background(), &GenerateProvenanceReq{
		SourceRepo:    "github.com/hashicorp/vault",
		GoVersionPath: goVersionPath,
		BinaryPath:    binaryPath,
		BuildFlags:    []string{"-X foo=bar"},
		BuilderID:     "test-builder",
		OutputPath:    outPath,
		Resolver: func(ctx context.Context) (string, bool, error) {
			// Mocks the output of `git rev-parse HEAD`.
			return mockRevParseSHA, false, nil
		},
		Now: func() time.Time { return fixedTime },
	})
	require.NoError(t, err)

	require.Equal(t, mockRevParseSHA, res.Attestation.Predicate.SourceCommitSHA)
	require.Equal(t, "github.com/hashicorp/vault", res.Attestation.Predicate.SourceRepo)
	require.Equal(t, "1.27.1b7", res.Attestation.Predicate.GoToolchainVersion)
	require.Equal(t, []string{"-X foo=bar"}, res.Attestation.Predicate.BuildFlags)
	require.Equal(t, "test-builder", res.Attestation.Predicate.BuilderID)
	require.Equal(t, "2026-01-02T03:04:05Z", res.Attestation.Predicate.BuildTimestamp)
	require.NotEqual(t, "UNAVAILABLE", res.Attestation.Predicate.BinaryArtifactSHA256)
	require.Empty(t, res.Attestation.Predicate.Warning)

	raw, err := os.ReadFile(outPath)
	require.NoError(t, err)
	var doc map[string]any
	require.NoError(t, json.Unmarshal(raw, &doc))
	predicate, ok := doc["predicate"].(map[string]any)
	require.True(t, ok)
	require.Equal(t, mockRevParseSHA, predicate["source_commit_sha"])
}

// TestGenerateProvenance_ShallowCloneSetsWarning covers edge_cases: "Git
// commit SHA cannot be resolved due to shallow clone -- provenance must
// include a warning field and use the available ref instead of failing."
func TestGenerateProvenance_ShallowCloneSetsWarning(t *testing.T) {
	tmpDir := t.TempDir()
	goVersionPath := filepath.Join(tmpDir, ".go-version")
	require.NoError(t, os.WriteFile(goVersionPath, []byte("1.27.1"), 0o644))

	res, err := GenerateProvenance(context.Background(), &GenerateProvenanceReq{
		SourceRepo:    "github.com/hashicorp/vault",
		GoVersionPath: goVersionPath,
		BinaryPath:    filepath.Join(tmpDir, "does-not-exist"),
		OutputPath:    filepath.Join(tmpDir, "provenance.json"),
		Resolver: func(ctx context.Context) (string, bool, error) {
			return "abc123", true, nil // simulates a shallow-clone rev-parse
		},
	})
	require.NoError(t, err)
	require.Equal(t, "abc123", res.Attestation.Predicate.SourceCommitSHA)
	require.Contains(t, res.Attestation.Predicate.Warning, "shallow")
}

// TestGenerateProvenance_BinaryUnavailableSetsErrorDetail covers
// error_handling: "If SHA computation fails on the binary artifact, the
// provenance generator sets binary_artifact_sha256 to 'UNAVAILABLE' with an
// error_detail field explaining the failure."
func TestGenerateProvenance_BinaryUnavailableSetsErrorDetail(t *testing.T) {
	tmpDir := t.TempDir()
	goVersionPath := filepath.Join(tmpDir, ".go-version")
	require.NoError(t, os.WriteFile(goVersionPath, []byte("1.27.1"), 0o644))

	res, err := GenerateProvenance(context.Background(), &GenerateProvenanceReq{
		SourceRepo:    "github.com/hashicorp/vault",
		GoVersionPath: goVersionPath,
		BinaryPath:    filepath.Join(tmpDir, "does-not-exist-binary"),
		OutputPath:    filepath.Join(tmpDir, "provenance.json"),
		Resolver: func(ctx context.Context) (string, bool, error) {
			return "abc123", false, nil
		},
	})
	require.NoError(t, err)
	require.Equal(t, "UNAVAILABLE", res.Attestation.Predicate.BinaryArtifactSHA256)
	require.NotEmpty(t, res.Attestation.Predicate.ErrorDetail)
}

// TestGenerateProvenance_GoVersionSuffixPreserved covers edge_cases: a
// .go-version file with a boringcrypto-style suffix (e.g. "1.27.1b7") must
// be captured verbatim.
func TestGenerateProvenance_GoVersionSuffixPreserved(t *testing.T) {
	tmpDir := t.TempDir()
	goVersionPath := filepath.Join(tmpDir, ".go-version")
	require.NoError(t, os.WriteFile(goVersionPath, []byte("1.27.1b7\n"), 0o644))

	res, err := GenerateProvenance(context.Background(), &GenerateProvenanceReq{
		SourceRepo:    "github.com/hashicorp/vault",
		GoVersionPath: goVersionPath,
		BinaryPath:    filepath.Join(tmpDir, "missing"),
		OutputPath:    filepath.Join(tmpDir, "provenance.json"),
		Resolver:      func(ctx context.Context) (string, bool, error) { return "abc", false, nil },
	})
	require.NoError(t, err)
	require.Equal(t, "1.27.1b7", res.Attestation.Predicate.GoToolchainVersion)
}

// TestGenerateProvenance_NoSecretsInOutput enforces the constraint: "Build
// provenance must not contain any secret values (tokens, keys,
// credentials)." It checks the attestation's own fields (not incidental
// filesystem paths, which may legitimately contain the test's own name).
func TestGenerateProvenance_NoSecretsInOutput(t *testing.T) {
	binDir := t.TempDir()
	goVersionPath := filepath.Join(binDir, ".go-version")
	require.NoError(t, os.WriteFile(goVersionPath, []byte("1.27.1"), 0o644))
	binaryPath := filepath.Join(binDir, "bin")
	require.NoError(t, os.WriteFile(binaryPath, []byte("binary"), 0o755))

	outDir := t.TempDir()
	outPath := filepath.Join(outDir, "provenance.json")
	res, err := GenerateProvenance(context.Background(), &GenerateProvenanceReq{
		SourceRepo:    "github.com/hashicorp/vault",
		GoVersionPath: goVersionPath,
		BinaryPath:    binaryPath,
		BuildFlags:    []string{"-X foo=bar", "-s", "-w"},
		BuilderID:     "ci-runner",
		OutputPath:    outPath,
		Resolver:      func(ctx context.Context) (string, bool, error) { return "abc", false, nil },
	})
	require.NoError(t, err)

	fields := []string{
		res.Attestation.Predicate.SourceCommitSHA,
		res.Attestation.Predicate.SourceRepo,
		res.Attestation.Predicate.GoToolchainVersion,
		res.Attestation.Predicate.BuilderID,
		res.Attestation.Predicate.BinaryArtifactSHA256,
		strings.Join(res.Attestation.Predicate.BuildFlags, " "),
	}
	for _, f := range fields {
		lower := strings.ToLower(f)
		for _, secretKey := range []string{"token", "password", "secret", "api_key", "apikey"} {
			require.NotContains(t, lower, secretKey)
		}
	}
}

func TestGenerateProvenance_RequiresSourceRepoAndOutputPath(t *testing.T) {
	_, err := GenerateProvenance(context.Background(), &GenerateProvenanceReq{})
	require.Error(t, err)

	_, err = GenerateProvenance(context.Background(), &GenerateProvenanceReq{SourceRepo: "github.com/hashicorp/vault"})
	require.Error(t, err)
}
