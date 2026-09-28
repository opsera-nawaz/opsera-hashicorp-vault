// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

// CryptoInventoryEntry is one package/module-level record in the flattened
// FIPS crypto inventory input consumed by AnnotateSBOM. See
// .release/fips-data/crypto-inventory-schema.json for the on-disk schema.
type CryptoInventoryEntry struct {
	PackageName      string   `json:"package_name"`
	PackageVersion   string   `json:"package_version"`
	Algorithms       []string `json:"algorithms"`
	FIPSApproved     bool     `json:"fips_approved"`
	SecurityRelevant bool     `json:"security_relevant"`
	SourceWorkOrder  string   `json:"source_work_order,omitempty"`
}

// CryptoInventory is the top-level document read from the --inventory file.
type CryptoInventory struct {
	SchemaVersion int                    `json:"schema_version"`
	GeneratedFrom []string               `json:"generated_from"`
	Entries       []CryptoInventoryEntry `json:"entries"`
}

// CryptoAnnotation is a single element of the annotated SBOM's
// crypto_annotations array (AC: package_name, package_version,
// algorithms_used, fips_approved, security_relevant).
type CryptoAnnotation struct {
	PackageName      string   `json:"package_name"`
	PackageVersion   string   `json:"package_version"`
	AlgorithmsUsed   []string `json:"algorithms_used"`
	FIPSApproved     bool     `json:"fips_approved"`
	SecurityRelevant bool     `json:"security_relevant"`
	// FoundInSBOM flags packages referenced by the crypto inventory that
	// have no corresponding component in the base SBOM (edge case: crypto
	// inventory references a package not present in the base SBOM).
	FoundInSBOM bool `json:"found_in_sbom"`
}

// AnnotateSBOMReq is the input to AnnotateSBOM.
type AnnotateSBOMReq struct {
	// SBOMPath is the path to the base SBOM produced upstream (e.g. by the
	// crt-generate-sbom CRT event / hashicorp/security-generate-release-sbom).
	SBOMPath string
	// InventoryPath is the path to the FIPS crypto inventory input file. If
	// empty, or if the file does not exist, the base SBOM is written through
	// unchanged with a warning (per error_handling).
	InventoryPath string
	// OutputPath is where the annotated SBOM is written.
	OutputPath string
}

// AnnotateSBOMRes is the result of a successful AnnotateSBOM call.
type AnnotateSBOMRes struct {
	OutputPath      string   `json:"output_path"`
	AnnotationCount int      `json:"annotation_count"`
	Warnings        []string `json:"warnings,omitempty"`
}

// AnnotateSBOM reads a base SBOM JSON document, merges in cryptographic
// dependency annotations sourced from the Phase 1 crypto inventory, and
// writes the annotated document to OutputPath. It never mutates or drops any
// field of the base SBOM -- it only adds a top-level "crypto_annotations"
// array (constraint: the annotated SBOM must not duplicate the base SBOM
// content, it extends it).
func AnnotateSBOM(req *AnnotateSBOMReq) (*AnnotateSBOMRes, error) {
	if req == nil || req.SBOMPath == "" {
		return nil, errors.New("annotate sbom: base sbom path is required")
	}
	if req.OutputPath == "" {
		return nil, errors.New("annotate sbom: output path is required")
	}

	raw, err := os.ReadFile(req.SBOMPath)
	if err != nil {
		return nil, fmt.Errorf("annotate sbom: reading base sbom %q: %w", req.SBOMPath, err)
	}

	var sbom map[string]any
	if err := json.Unmarshal(raw, &sbom); err != nil {
		return nil, fmt.Errorf("annotate sbom: base sbom %q is not valid JSON: %w", req.SBOMPath, err)
	}

	res := &AnnotateSBOMRes{OutputPath: req.OutputPath}

	inventory, warning, err := loadCryptoInventory(req.InventoryPath)
	if err != nil {
		return nil, err
	}
	if warning != "" {
		slog.Default().Warn(warning)
		res.Warnings = append(res.Warnings, warning)
	}

	components := sbomComponentNames(sbom)

	annotations := make([]CryptoAnnotation, 0, len(inventory.Entries))
	for _, e := range inventory.Entries {
		annotations = append(annotations, CryptoAnnotation{
			PackageName:      e.PackageName,
			PackageVersion:   e.PackageVersion,
			AlgorithmsUsed:   e.Algorithms,
			FIPSApproved:     e.FIPSApproved,
			SecurityRelevant: e.SecurityRelevant,
			FoundInSBOM:      packageFoundInSBOM(components, e.PackageName),
		})
	}
	if len(inventory.Entries) == 0 && warning == "" {
		res.Warnings = append(res.Warnings, "crypto inventory contained zero entries; crypto_annotations will be empty")
	}

	sbom["crypto_annotations"] = annotations
	res.AnnotationCount = len(annotations)

	out, err := json.MarshalIndent(sbom, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("annotate sbom: marshaling annotated sbom: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(req.OutputPath), 0o755); err != nil {
		return nil, fmt.Errorf("annotate sbom: creating output directory for %q: %w", req.OutputPath, err)
	}
	if err := os.WriteFile(req.OutputPath, out, 0o644); err != nil {
		return nil, fmt.Errorf("annotate sbom: writing annotated sbom to %q: %w", req.OutputPath, err)
	}

	return res, nil
}

// loadCryptoInventory reads and decodes the crypto inventory input file. A
// missing path (empty string) or missing file is not an error -- it produces
// an empty inventory plus a warning, per error_handling: "If the crypto
// inventory is missing, the annotator produces the base SBOM unchanged with a
// warning logged to stderr."
func loadCryptoInventory(path string) (*CryptoInventory, string, error) {
	inventory := &CryptoInventory{}

	if path == "" {
		return inventory, "no crypto inventory path provided; writing base SBOM unannotated", nil
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return inventory, fmt.Sprintf("crypto inventory file %q not found; writing base SBOM unannotated", path), nil
		}
		return nil, "", fmt.Errorf("annotate sbom: reading crypto inventory %q: %w", path, err)
	}

	if err := json.Unmarshal(raw, inventory); err != nil {
		return nil, "", fmt.Errorf("annotate sbom: crypto inventory %q is not valid JSON: %w", path, err)
	}

	return inventory, "", nil
}

// sbomComponentNames extracts every component "name" (and, if present,
// "purl") string from a generic CycloneDX-shaped SBOM document, tolerating
// SBOMs that don't have a "components" array at all.
func sbomComponentNames(sbom map[string]any) []string {
	var names []string

	componentsRaw, ok := sbom["components"].([]any)
	if !ok {
		return names
	}

	for _, c := range componentsRaw {
		comp, ok := c.(map[string]any)
		if !ok {
			continue
		}
		if name, ok := comp["name"].(string); ok && name != "" {
			names = append(names, name)
		}
		if purl, ok := comp["purl"].(string); ok && purl != "" {
			names = append(names, purl)
		}
	}

	return names
}

// packageFoundInSBOM reports whether packageName is represented in the base
// SBOM's component list.
//
// Go standard library packages (e.g. "crypto/aes") are compiled directly
// into the binary and are not resolvable Go modules, so module-graph-based
// SBOM generators (e.g. `cyclonedx-gomod mod -std`) represent the entire
// standard library as a single aggregate "std" pseudo-module component
// rather than as individual per-package components. Non-stdlib packages are
// matched by prefix against component names/purls, since a component
// typically names the module root (e.g. "golang.org/x/crypto") while the
// inventory entry names a specific sub-package
// (e.g. "golang.org/x/crypto/chacha20poly1305").
func packageFoundInSBOM(components []string, packageName string) bool {
	firstSegment := packageName
	if idx := strings.Index(packageName, "/"); idx >= 0 {
		firstSegment = packageName[:idx]
	}
	isStdlib := !strings.Contains(firstSegment, ".")

	for _, c := range components {
		if isStdlib {
			if c == "std" || strings.Contains(c, "pkg:golang/std@") {
				return true
			}
			continue
		}
		if strings.HasPrefix(packageName, c) || strings.Contains(c, packageName) {
			return true
		}
	}

	return false
}
