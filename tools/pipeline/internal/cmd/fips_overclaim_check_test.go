// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package cmd

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestOverclaimCheck_MissingDirectory verifies the error_handling requirement:
// a non-existent directory produces an empty, passing result and no error.
func TestOverclaimCheck_MissingDirectory(t *testing.T) {
	res, err := OverclaimCheck(filepath.Join(t.TempDir(), "does-not-exist"))
	require.NoError(t, err)
	require.True(t, res.Passed())
	require.Equal(t, 0, res.FilesScanned)
	require.Empty(t, res.Findings)
}

// TestOverclaimCheck_Fixtures runs the check against the full testdata
// fixture directory and asserts exactly the expected findings: only
// overclaim-no-evidence.txt and case-insensitive-overclaim.txt lack an
// adjacent CMVP reference. Every other fixture (CMVP-evidenced overclaim,
// approved language, multi-line CMVP proximity, enterprise packaging
// language, and the FIPS-path compound term) must pass cleanly.
func TestOverclaimCheck_Fixtures(t *testing.T) {
	res, err := OverclaimCheck("testdata/overclaim")
	require.NoError(t, err)
	require.False(t, res.Passed())
	require.GreaterOrEqual(t, res.FilesScanned, 7)

	flaggedFiles := map[string]bool{}
	for _, f := range res.Findings {
		flaggedFiles[filepath.Base(f.File)] = true
	}
	require.Equal(t, map[string]bool{
		"overclaim-no-evidence.txt":      true,
		"case-insensitive-overclaim.txt": true,
	}, flaggedFiles)
}

// TestOverclaimCheck_SingleFile verifies OverclaimCheck also accepts a
// single file path (not just a directory), which the CLI relies on to scan
// top-level CHANGELOG.md-style files alongside the changelog/ directory.
func TestOverclaimCheck_SingleFile(t *testing.T) {
	res, err := OverclaimCheck("testdata/overclaim/overclaim-no-evidence.txt")
	require.NoError(t, err)
	require.Equal(t, 1, res.FilesScanned)
	require.Len(t, res.Findings, 1)

	res, err = OverclaimCheck("testdata/overclaim/approved-language.txt")
	require.NoError(t, err)
	require.Equal(t, 1, res.FilesScanned)
	require.True(t, res.Passed())
}

// TestScanOverclaimContent_OverclaimWithoutEvidence covers: overclaiming
// without evidence must FAIL (a finding is produced) — implementation_steps
// scenario 1.
func TestScanOverclaimContent_OverclaimWithoutEvidence(t *testing.T) {
	findings := scanOverclaimContent("changelog/1.txt", []byte("Vault is now FIPS validated."))
	require.Len(t, findings, 1)
	require.Equal(t, "FIPS validated", findings[0].Phrase)
	require.Equal(t, 1, findings[0].Line)
}

// TestScanOverclaimContent_OverclaimWithCMVPReference covers: overclaiming
// with an adjacent CMVP certificate reference must PASS — scenario 2.
func TestScanOverclaimContent_OverclaimWithCMVPReference(t *testing.T) {
	findings := scanOverclaimContent(
		"changelog/2.txt",
		[]byte("Vault uses AWS KMS (CMVP #4523) for FIPS validated encryption."),
	)
	require.Empty(t, findings)
}

// TestScanOverclaimContent_ApprovedLanguage covers: approved disclaimer-safe
// language must PASS — scenario 3.
func TestScanOverclaimContent_ApprovedLanguage(t *testing.T) {
	for _, phrase := range overclaimApprovedPhrases {
		findings := scanOverclaimContent("changelog/3.txt", []byte("Vault establishes a "+phrase+" for Community Edition."))
		require.Empty(t, findings, "approved phrase %q must not be flagged", phrase)
	}
}

// TestScanOverclaimContent_CaseInsensitive covers: matching must be
// case-insensitive — scenario 4.
func TestScanOverclaimContent_CaseInsensitive(t *testing.T) {
	variants := []string{
		"vault is now fips validated",
		"Vault Is Now FIPS Validated",
		"VAULT IS NOW FIPS VALIDATED",
	}
	for _, v := range variants {
		findings := scanOverclaimContent("changelog/4.txt", []byte(v))
		require.Len(t, findings, 1, "variant %q should match case-insensitively", v)
	}
}

// TestScanOverclaimContent_EnterprisePackagingLanguage covers: factual
// enterprise-edition packaging language referencing FIPS 140-2 must not be
// flagged — scenario 5. This is not one of the prohibited phrases (it does
// not claim "validated"/"certified"/"compliant"), so it must PASS.
func TestScanOverclaimContent_EnterprisePackagingLanguage(t *testing.T) {
	findings := scanOverclaimContent(
		"changelog/16992.txt",
		[]byte("core/fips: Add RPM, DEB packages of FIPS 140-2 and HSM+FIPS 140-2 Vault Enterprise."),
	)
	require.Empty(t, findings)
}

// TestScanOverclaimContent_CompoundTerm covers the edge case: "FIPS" as part
// of a compound term (e.g. "FIPS-path") must not be matched via a bare
// substring — word-boundary matching on full multi-word phrases prevents
// this false positive.
func TestScanOverclaimContent_CompoundTerm(t *testing.T) {
	findings := scanOverclaimContent("changelog/5.txt", []byte("core/fips-path: refactor the FIPS-path build tag plumbing."))
	require.Empty(t, findings)
}

// TestScanOverclaimContent_ProximityAcrossLines covers the edge case: a CMVP
// reference on a different line than the prohibited phrase must still be
// found by the 200-character proximity window, since it operates on the
// whole file content rather than per line.
func TestScanOverclaimContent_ProximityAcrossLines(t *testing.T) {
	content := "Vault is now FIPS validated\nwhen configured with AWS KMS auto-unseal (CMVP #4523).\n"
	findings := scanOverclaimContent("changelog/6.txt", []byte(content))
	require.Empty(t, findings)
}

// TestScanOverclaimContent_OutsideProximityWindow verifies that a CMVP
// reference far outside the configured proximity window does not suppress
// the finding.
func TestScanOverclaimContent_OutsideProximityWindow(t *testing.T) {
	padding := make([]byte, overclaimCMVPProximityWindow+50)
	for i := range padding {
		padding[i] = ' '
	}
	content := "Vault is now FIPS validated." + string(padding) + "See CMVP #4523 for unrelated context."
	findings := scanOverclaimContent("changelog/7.txt", []byte(content))
	require.Len(t, findings, 1)
}
