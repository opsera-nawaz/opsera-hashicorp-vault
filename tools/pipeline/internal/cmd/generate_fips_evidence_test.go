// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package cmd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func fipsFixedNow() func() time.Time {
	return func() time.Time { return time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC) }
}

func fipsTestdata(name string) string {
	return filepath.Join("testdata", "fips-evidence", name)
}

// TestGenerateFIPSEvidence_GoldenPackage is the AC #2/#9 golden-file test: it
// runs the full generator against the fixture CMVP data, exception records,
// and an unset-TLS vault config, and compares the result byte-for-byte
// (after JSON normalization) against testdata/fips-evidence/expected-output.json.
func TestGenerateFIPSEvidence_GoldenPackage(t *testing.T) {
	outPath := filepath.Join(t.TempDir(), "evidence.json")

	res, err := GenerateFIPSEvidence(&GenerateFIPSEvidenceReq{
		ReleaseVersion:   "2.2.0-beta1-test",
		CMVPPath:         fipsTestdata("sample-cmvp-certificates.json"),
		ExceptionsPath:   fipsTestdata("sample-exceptions.json"),
		VaultConfigPath:  fipsTestdata("sample-vault-unset.hcl"),
		RiskRegisterPath: "docs/fips/residual-crypto-risk-register.md",
		SBOMPath:         ".release/sbom/2.2.0-beta1-test-annotated-sbom.json",
		ProvenancePath:   ".release/provenance/2.2.0-beta1-test-provenance.json",
		OutputPath:       outPath,
		Now:              fipsFixedNow(),
	})
	require.NoError(t, err)
	require.Equal(t, outPath, res.OutputPath)

	got, err := os.ReadFile(outPath)
	require.NoError(t, err)
	want, err := os.ReadFile(fipsTestdata("expected-output.json"))
	require.NoError(t, err)

	var gotJSON, wantJSON map[string]any
	require.NoError(t, json.Unmarshal(got, &gotJSON))
	require.NoError(t, json.Unmarshal(want, &wantJSON))
	require.Equal(t, wantJSON, gotJSON)
}

// TestGenerateFIPSEvidence_MissingCMVPFile_ReturnsError covers error_handling:
// "If the CMVP certificates data file is missing, the generator exits with
// error code 1 and a message identifying the expected path."
func TestGenerateFIPSEvidence_MissingCMVPFile_ReturnsError(t *testing.T) {
	tmpDir := t.TempDir()
	missing := filepath.Join(tmpDir, "does-not-exist.json")

	_, err := GenerateFIPSEvidence(&GenerateFIPSEvidenceReq{
		CMVPPath:   missing,
		OutputPath: filepath.Join(tmpDir, "out.json"),
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), missing)
}

func TestGenerateFIPSEvidence_RequiresOutputPath(t *testing.T) {
	_, err := GenerateFIPSEvidence(&GenerateFIPSEvidenceReq{})
	require.Error(t, err)

	_, err = GenerateFIPSEvidence(nil)
	require.Error(t, err)
}

// TestGenerateFIPSEvidence_GeneratedAtISO8601 covers implementation_steps:
// "ISO 8601 timestamp formatting".
func TestGenerateFIPSEvidence_GeneratedAtISO8601(t *testing.T) {
	outPath := filepath.Join(t.TempDir(), "evidence.json")

	res, err := GenerateFIPSEvidence(&GenerateFIPSEvidenceReq{
		CMVPPath:   fipsTestdata("sample-cmvp-certificates.json"),
		OutputPath: outPath,
		Now:        fipsFixedNow(),
	})
	require.NoError(t, err)
	require.Equal(t, "2026-09-27T12:00:00Z", res.Package.GeneratedAt)

	_, err = time.Parse(time.RFC3339, res.Package.GeneratedAt)
	require.NoError(t, err, "generated_at must be a valid ISO 8601 / RFC3339 timestamp")

	for _, entry := range res.Package.VerificationLog {
		_, err := time.Parse(time.RFC3339, entry.Timestamp)
		require.NoError(t, err, "verification_log entry for %s must have an ISO 8601 timestamp, got %q", entry.CheckID, entry.Timestamp)
	}
}

// TestGenerateFIPSEvidence_NoOverclaimLanguage enforces the constraint: "The
// evidence package must never contain text claiming Vault is 'FIPS
// validated' or 'FIPS certified'."
func TestGenerateFIPSEvidence_NoOverclaimLanguage(t *testing.T) {
	outPath := filepath.Join(t.TempDir(), "evidence.json")

	_, err := GenerateFIPSEvidence(&GenerateFIPSEvidenceReq{
		ReleaseVersion:  "2.2.0-beta1-test",
		CMVPPath:        fipsTestdata("sample-cmvp-certificates.json"),
		ExceptionsPath:  fipsTestdata("sample-exceptions.json"),
		VaultConfigPath: fipsTestdata("sample-vault-unset.hcl"),
		OutputPath:      outPath,
		Now:             fipsFixedNow(),
	})
	require.NoError(t, err)

	raw, err := os.ReadFile(outPath)
	require.NoError(t, err)
	lower := strings.ToLower(string(raw))

	forbidden := []string{
		"vault is fips validated",
		"vault is fips certified",
		"vault is fips compliant",
		"vault has been fips validated",
		"vault has been fips certified",
	}
	for _, phrase := range forbidden {
		require.NotContains(t, lower, phrase)
	}
}

// TestLoadCMVPCertificates_ValidData covers implementation_steps: "valid
// CMVP data loading" and edge_cases: "CMVP certificate has expired between
// evidence package generations -- generator must check expiry_date against
// current date and set validation_status to expired with a warning."
func TestLoadCMVPCertificates_ValidData(t *testing.T) {
	now := fipsFixedNow()()
	certs, warnings, err := loadCMVPCertificates(fipsTestdata("sample-cmvp-certificates.json"), now)
	require.NoError(t, err)
	require.Len(t, certs, 3)
	require.Len(t, warnings, 2, "AWS (2020-01-01) and GCP (2026-09-21) fixtures are both expired as of the fixed clock")

	byProvider := make(map[string]CMVPCertificate, len(certs))
	for _, c := range certs {
		byProvider[c.Provider] = c
	}

	require.Equal(t, "expired", byProvider["AWS KMS"].ValidationStatus)
	require.Equal(t, "expired", byProvider["GCP Cloud KMS"].ValidationStatus)
	require.Equal(t, "active", byProvider["Azure Key Vault"].ValidationStatus)
}

// TestLoadCMVPCertificates_MissingFile_ReturnsError covers implementation_steps:
// "missing CMVP file error handling".
func TestLoadCMVPCertificates_MissingFile_ReturnsError(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "does-not-exist.json")
	_, _, err := loadCMVPCertificates(missing, time.Now())
	require.Error(t, err)
	require.Contains(t, err.Error(), missing)

	_, _, err = loadCMVPCertificates("", time.Now())
	require.Error(t, err)
}

func TestLoadCMVPCertificates_MalformedJSON_ReturnsError(t *testing.T) {
	tmpDir := t.TempDir()
	malformed := filepath.Join(tmpDir, "malformed.json")
	require.NoError(t, os.WriteFile(malformed, []byte(`{not valid json`), 0o644))

	_, _, err := loadCMVPCertificates(malformed, time.Now())
	require.Error(t, err)
	require.Contains(t, err.Error(), "not valid JSON")
}

// TestLoadExceptionRecords_MissingFile_ReturnsReviewEntry covers edge_cases:
// "Exception records file is missing or empty -- generator must produce the
// evidence package with an empty exceptions array and a REVIEW entry in the
// verification_log noting missing exception data."
func TestLoadExceptionRecords_MissingFile_ReturnsReviewEntry(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "does-not-exist.json")
	records, entry, err := loadExceptionRecords(missing, fipsFixedNow())
	require.NoError(t, err)
	require.Empty(t, records)
	require.NotNil(t, entry)
	require.Equal(t, StatusReview, entry.Status)
	require.Contains(t, entry.Notes, "not found")
}

func TestLoadExceptionRecords_EmptyPath_ReturnsReviewEntry(t *testing.T) {
	records, entry, err := loadExceptionRecords("", fipsFixedNow())
	require.NoError(t, err)
	require.Empty(t, records)
	require.NotNil(t, entry)
	require.Equal(t, StatusReview, entry.Status)
}

// TestLoadExceptionRecords_MalformedJSON_ReturnsFailEntry covers
// error_handling: "If exception records are malformed JSON, the generator
// logs a structured error and produces the evidence package with a FAIL
// entry in the verification_log for the exception-tracking check."
func TestLoadExceptionRecords_MalformedJSON_ReturnsFailEntry(t *testing.T) {
	tmpDir := t.TempDir()
	malformed := filepath.Join(tmpDir, "malformed.json")
	require.NoError(t, os.WriteFile(malformed, []byte(`{not valid json`), 0o644))

	records, entry, err := loadExceptionRecords(malformed, fipsFixedNow())
	require.NoError(t, err)
	require.Empty(t, records)
	require.NotNil(t, entry)
	require.Equal(t, StatusFail, entry.Status)
}

func TestLoadExceptionRecords_EmptyExceptionsArray_ReturnsReviewEntry(t *testing.T) {
	tmpDir := t.TempDir()
	empty := filepath.Join(tmpDir, "empty-exceptions.json")
	require.NoError(t, os.WriteFile(empty, []byte(`{"schema_version":1,"exceptions":[]}`), 0o644))

	records, entry, err := loadExceptionRecords(empty, fipsFixedNow())
	require.NoError(t, err)
	require.Empty(t, records)
	require.NotNil(t, entry)
	require.Equal(t, StatusReview, entry.Status)
}

// TestVerificationEntryForException_CoercesInvalidStatusToReview covers
// implementation_steps: "status-integrity invariant enforcement
// (REVIEW/EXCEPTION never merged to PASS)" -- even a malformed exception
// record that declares status PASS must never survive as PASS.
func TestVerificationEntryForException_CoercesInvalidStatusToReview(t *testing.T) {
	e := ExceptionRecord{
		ExceptionID: "EXC-BAD-001",
		CheckID:     "FIPS-DEP-001",
		Status:      "PASS",
		Reason:      "malformed upstream record",
		CreatedAt:   "2026-01-01T00:00:00Z",
	}
	entry := verificationEntryForException(e, "exceptions.json", fipsFixedNow())
	require.Equal(t, StatusReview, entry.Status)
	require.Contains(t, entry.Notes, "invalid status")
	require.Equal(t, "EXC-BAD-001", entry.SourceExceptionID)
}

func TestVerificationEntryForException_PreservesValidStatus(t *testing.T) {
	for _, status := range []string{StatusFail, StatusReview, StatusException} {
		e := ExceptionRecord{
			ExceptionID: "EXC-OK",
			CheckID:     "FIPS-CRYPTO-002",
			Status:      status,
			Reason:      "valid",
			CreatedAt:   "2026-01-01T00:00:00Z",
		}
		entry := verificationEntryForException(e, "exceptions.json", fipsFixedNow())
		require.Equal(t, status, entry.Status)
	}
}

// TestValidateVerificationLogIntegrity_DetectsPassOverridingException is the
// AC #5 unit test: it constructs a verification log where an EXCEPTION-status
// exception has been (incorrectly) represented as PASS, and asserts the
// validator rejects it.
func TestValidateVerificationLogIntegrity_DetectsPassOverridingException(t *testing.T) {
	exceptions := []ExceptionRecord{
		{ExceptionID: "EXC-1", CheckID: "FIPS-CRYPTO-002", Status: StatusException},
	}
	log := []VerificationLogEntry{
		{CheckID: "FIPS-CRYPTO-002", Status: StatusPass, SourceExceptionID: "EXC-1"},
	}
	err := ValidateVerificationLogIntegrity(log, exceptions)
	require.Error(t, err)
	require.Contains(t, err.Error(), "status-integrity violation")
}

func TestValidateVerificationLogIntegrity_RejectsUnrecognizedStatus(t *testing.T) {
	log := []VerificationLogEntry{
		{CheckID: "FIPS-CRYPTO-002", Status: "MAYBE"},
	}
	err := ValidateVerificationLogIntegrity(log, nil)
	require.Error(t, err)
}

func TestValidateVerificationLogIntegrity_AcceptsValidLog(t *testing.T) {
	exceptions := []ExceptionRecord{
		{ExceptionID: "EXC-1", CheckID: "FIPS-CRYPTO-002", Status: StatusException},
	}
	log := []VerificationLogEntry{
		{CheckID: "FIPS-CRYPTO-001", Status: StatusPass},
		{CheckID: "FIPS-CRYPTO-002", Status: StatusException, SourceExceptionID: "EXC-1"},
	}
	require.NoError(t, ValidateVerificationLogIntegrity(log, exceptions))
}

// TestValidateVerificationLogIntegrity_ParsesSampleEvidencePackage is the
// literal AC #5 requirement: "a unit test in tools/pipeline/ validates this
// invariant by parsing a sample evidence package."
func TestValidateVerificationLogIntegrity_ParsesSampleEvidencePackage(t *testing.T) {
	raw, err := os.ReadFile(fipsTestdata("expected-output.json"))
	require.NoError(t, err)

	var pkg EvidencePackage
	require.NoError(t, json.Unmarshal(raw, &pkg))
	require.NotEmpty(t, pkg.VerificationLog)

	require.NoError(t, ValidateVerificationLogIntegrity(pkg.VerificationLog, pkg.Exceptions))

	// The fixture's EXC-2026-003 record declares an invalid status of PASS
	// (see testdata/fips-evidence/sample-exceptions.json); confirm its
	// verification_log entry was coerced to REVIEW, not silently trusted.
	var found bool
	for _, entry := range pkg.VerificationLog {
		if entry.SourceExceptionID == "EXC-2026-003" {
			found = true
			require.NotEqual(t, StatusPass, entry.Status)
			require.Equal(t, StatusReview, entry.Status)
		}
	}
	require.True(t, found, "expected-output.json fixture must include the coerced EXC-2026-003 entry")
}

// TestExtractTLSListenerConfig_UnsetValues_NotExplicit covers edge_cases:
// "TLS configuration template contains no explicit cipher_suites --
// generator must flag this as a REVIEW finding rather than assuming
// defaults are Approved."
func TestExtractTLSListenerConfig_UnsetValues_NotExplicit(t *testing.T) {
	cfg, err := extractTLSListenerConfig(fipsTestdata("sample-vault-unset.hcl"))
	require.NoError(t, err)
	require.False(t, cfg.TLSMinVersionExplicit)
	require.False(t, cfg.CipherSuitesExplicit)
	require.Equal(t, "tcp", cfg.ListenerType)
}

func TestExtractTLSListenerConfig_ApprovedValues_Explicit(t *testing.T) {
	cfg, err := extractTLSListenerConfig(fipsTestdata("sample-vault-approved.hcl"))
	require.NoError(t, err)
	require.True(t, cfg.TLSMinVersionExplicit)
	require.Equal(t, "tls12", cfg.TLSMinVersion)
	require.True(t, cfg.CipherSuitesExplicit)
	require.Equal(t, []string{"TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256", "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384"}, cfg.CipherSuites)
}

func TestExtractTLSListenerConfig_MissingFile_ReturnsError(t *testing.T) {
	_, err := extractTLSListenerConfig(filepath.Join(t.TempDir(), "does-not-exist.hcl"))
	require.Error(t, err)
}

func TestExtractTLSListenerConfig_EmptyPath_ReturnsNoteOnly(t *testing.T) {
	cfg, err := extractTLSListenerConfig("")
	require.NoError(t, err)
	require.NotEmpty(t, cfg.Notes)
}

func TestEvaluateTLSListenerConfig_ReviewWhenNotExplicit(t *testing.T) {
	cfg, err := extractTLSListenerConfig(fipsTestdata("sample-vault-unset.hcl"))
	require.NoError(t, err)
	entry := evaluateTLSListenerConfig(cfg, "2026-09-27T12:00:00Z")
	require.Equal(t, StatusReview, entry.Status)
}

func TestEvaluateTLSListenerConfig_PassWhenApprovedAndExplicit(t *testing.T) {
	cfg, err := extractTLSListenerConfig(fipsTestdata("sample-vault-approved.hcl"))
	require.NoError(t, err)
	entry := evaluateTLSListenerConfig(cfg, "2026-09-27T12:00:00Z")
	require.Equal(t, StatusPass, entry.Status)
}

// TestEvaluateTLSListenerConfig_FailWhenNonApprovedCipher covers RR-005-style
// non-Approved cipher suite detection.
func TestEvaluateTLSListenerConfig_FailWhenNonApprovedCipher(t *testing.T) {
	cfg, err := extractTLSListenerConfig(fipsTestdata("sample-vault-nonapproved.hcl"))
	require.NoError(t, err)
	entry := evaluateTLSListenerConfig(cfg, "2026-09-27T12:00:00Z")
	require.Equal(t, StatusFail, entry.Status)
	require.Contains(t, entry.Notes, "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305")
	require.Equal(t, []string{"TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305"}, cfg.NonApprovedCiphersFound)
}
