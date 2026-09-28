// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package cmd

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
)

var annotateSBOMReq = &AnnotateSBOMReq{}

func newSbomAnnotateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "annotate",
		Short: "Annotate a base SBOM with FIPS 140-3 crypto dependency metadata",
		Long: `Annotate a base SBOM (produced upstream by the crt-generate-sbom CRT event)
with a crypto_annotations array sourced from the Phase 1 FIPS cryptographic
inventory. Each crypto-relevant package receives its algorithms, FIPS-Approved
status, and security relevance. The base SBOM's own content is never modified
or duplicated -- only the crypto_annotations array is added.

Examples:
  pipeline sbom annotate \
    --sbom .release/sbom/1.2.3-sbom.json \
    --inventory .release/fips-data/crypto-inventory.json \
    --output .release/sbom/1.2.3-annotated-sbom.json`,
		RunE: runSbomAnnotateCmd,
	}

	cmd.Flags().StringVar(&annotateSBOMReq.SBOMPath, "sbom", "", "Path to the base SBOM JSON file (required)")
	cmd.Flags().StringVar(&annotateSBOMReq.InventoryPath, "inventory", "", "Path to the FIPS crypto inventory JSON file")
	cmd.Flags().StringVar(&annotateSBOMReq.OutputPath, "output", "", "Path to write the annotated SBOM JSON to (required)")

	return cmd
}

func runSbomAnnotateCmd(cmd *cobra.Command, args []string) error {
	cmd.SilenceUsage = true

	if annotateSBOMReq.SBOMPath == "" {
		return fmt.Errorf("annotate sbom: --sbom is required")
	}
	if annotateSBOMReq.OutputPath == "" {
		return fmt.Errorf("annotate sbom: --output is required")
	}

	res, err := AnnotateSBOM(annotateSBOMReq)
	if err != nil {
		return fmt.Errorf("annotating sbom: %w", err)
	}

	switch rootCfg.format {
	case "json":
		b, jsonErr := json.Marshal(res)
		if jsonErr != nil {
			return jsonErr
		}
		fmt.Println(string(b))
	default:
		fmt.Printf("Annotated SBOM written to %s (%d crypto annotations)\n", res.OutputPath, res.AnnotationCount)
		for _, w := range res.Warnings {
			fmt.Printf("warning: %s\n", w)
		}
	}

	return nil
}
