// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package cmd

import (
	"encoding/json"
	"fmt"
	"path/filepath"

	"github.com/spf13/cobra"
)

var generateFIPSEvidenceReq = &GenerateFIPSEvidenceReq{}

var (
	fipsEvidenceCMVPFlag         string
	fipsEvidenceExceptionsFlag   string
	fipsEvidenceVaultConfigFlag  string
	fipsEvidenceRiskRegisterFlag string
	fipsEvidenceSBOMFlag         string
	fipsEvidenceProvenanceFlag   string
)

func newFipsEvidenceCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "evidence",
		Short: "Generate a dated FIPS 140-3 evidence package",
		Long: `Assemble CMVP certificate references, a TLS listener configuration
snapshot, algorithm-restriction verification results, and exception records
consumed from the exception tracking system into a single dated JSON
evidence package, alongside references to the release's SBOM, build
provenance attestation, and residual crypto risk register.

Examples:
  pipeline fips evidence \
    --release-version 1.2.3 \
    --output .release/fips-evidence/20260927T153045Z-fips-evidence.json`,
		RunE: runFipsEvidenceCmd,
	}

	cmd.Flags().StringVar(&generateFIPSEvidenceReq.ReleaseVersion, "release-version", "", "The release version this evidence package documents")
	cmd.Flags().StringVar(&fipsEvidenceCMVPFlag, "cmvp-certificates", "", "Path to the CMVP certificate reference data file (default: <repo-root>/.release/fips-data/cmvp-certificates.json)")
	cmd.Flags().StringVar(&fipsEvidenceExceptionsFlag, "exceptions", "", "Path to the exception-tracking-system output file (default: <repo-root>/.release/fips-data/fips-exceptions.json)")
	cmd.Flags().StringVar(&fipsEvidenceVaultConfigFlag, "vault-config", "", "Path to the Vault server config template to extract TLS listener settings from (default: <repo-root>/.release/linux/package/etc/vault.d/vault.hcl)")
	cmd.Flags().StringVar(&fipsEvidenceRiskRegisterFlag, "risk-register", "", "Path to the residual crypto risk register (default: <repo-root>/docs/fips/residual-crypto-risk-register.md)")
	cmd.Flags().StringVar(&fipsEvidenceSBOMFlag, "sbom", "", "Path to the release's annotated SBOM (default: <repo-root>/.release/sbom/<release-version>-annotated-sbom.json)")
	cmd.Flags().StringVar(&fipsEvidenceProvenanceFlag, "provenance", "", "Path to the release's build provenance attestation (default: <repo-root>/.release/provenance/<release-version>-provenance.json)")
	cmd.Flags().StringVar(&generateFIPSEvidenceReq.OutputPath, "output", "", "Path to write the evidence package JSON to (required)")

	return cmd
}

func runFipsEvidenceCmd(cmd *cobra.Command, args []string) error {
	cmd.SilenceUsage = true

	if generateFIPSEvidenceReq.OutputPath == "" {
		return fmt.Errorf("fips evidence: --output is required")
	}

	repoRoot := rootCfg.repoRoot
	generateFIPSEvidenceReq.RepoRoot = repoRoot

	generateFIPSEvidenceReq.CMVPPath = fipsDefaultPath(fipsEvidenceCMVPFlag, repoRoot, ".release", "fips-data", "cmvp-certificates.json")
	generateFIPSEvidenceReq.ExceptionsPath = fipsDefaultPath(fipsEvidenceExceptionsFlag, repoRoot, ".release", "fips-data", "fips-exceptions.json")
	generateFIPSEvidenceReq.VaultConfigPath = fipsDefaultPath(fipsEvidenceVaultConfigFlag, repoRoot, ".release", "linux", "package", "etc", "vault.d", "vault.hcl")
	generateFIPSEvidenceReq.RiskRegisterPath = fipsDefaultPath(fipsEvidenceRiskRegisterFlag, repoRoot, "docs", "fips", "residual-crypto-risk-register.md")

	switch {
	case fipsEvidenceSBOMFlag != "":
		generateFIPSEvidenceReq.SBOMPath = fipsEvidenceSBOMFlag
	case generateFIPSEvidenceReq.ReleaseVersion != "":
		generateFIPSEvidenceReq.SBOMPath = fipsDefaultPath("", repoRoot, ".release", "sbom", generateFIPSEvidenceReq.ReleaseVersion+"-annotated-sbom.json")
	}

	switch {
	case fipsEvidenceProvenanceFlag != "":
		generateFIPSEvidenceReq.ProvenancePath = fipsEvidenceProvenanceFlag
	case generateFIPSEvidenceReq.ReleaseVersion != "":
		generateFIPSEvidenceReq.ProvenancePath = fipsDefaultPath("", repoRoot, ".release", "provenance", generateFIPSEvidenceReq.ReleaseVersion+"-provenance.json")
	}

	res, err := GenerateFIPSEvidence(generateFIPSEvidenceReq)
	if err != nil {
		return fmt.Errorf("generating fips evidence: %w", err)
	}

	switch rootCfg.format {
	case "json":
		b, jsonErr := json.MarshalIndent(res.Package, "", "  ")
		if jsonErr != nil {
			return jsonErr
		}
		fmt.Println(string(b))
	default:
		fmt.Printf("FIPS evidence package written to %s\n", res.OutputPath)
		fmt.Printf("  cmvp_certificates:       %d\n", len(res.Package.CMVPCertificates))
		fmt.Printf("  verification_log entries: %d\n", len(res.Package.VerificationLog))
		fmt.Printf("  exceptions:              %d\n", len(res.Package.Exceptions))
		for _, w := range res.Warnings {
			fmt.Printf("warning: %s\n", w)
		}
	}

	return nil
}

// fipsDefaultPath returns flagVal if set, otherwise joins repoRoot (if
// non-empty) with parts, otherwise joins parts alone (relative to the
// current working directory).
func fipsDefaultPath(flagVal, repoRoot string, parts ...string) string {
	if flagVal != "" {
		return flagVal
	}
	if repoRoot == "" {
		return filepath.Join(parts...)
	}
	return filepath.Join(append([]string{repoRoot}, parts...)...)
}
