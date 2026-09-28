// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package cmd

import (
	"github.com/spf13/cobra"
)

func newSbomCmd() *cobra.Command {
	sbomCmd := &cobra.Command{
		Use:   "sbom",
		Short: "SBOM commands",
		Long:  "Commands for post-processing release SBOMs with FIPS 140-3 cryptographic annotations and build provenance",
	}
	sbomCmd.AddCommand(newSbomAnnotateCmd())
	sbomCmd.AddCommand(newSbomProvenanceCmd())

	return sbomCmd
}
