// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package cmd

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func exceptionsFixedNow() func() time.Time {
	return func() time.Time { return time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC) }
}

func exceptionsTestdata(name string) string {
	return filepath.Join("testdata", "exceptions", name)
}

// TestValidateExceptions_ValidFile is the AC #6 "valid exception file" case:
// a schema-compliant registry validates with no errors.
func TestValidateExceptions_ValidFile(t *testing.T) {
	res, err := ValidateExceptions(&ValidateExceptionsReq{
		Path: exceptionsTestdata("valid-exceptions.json"),
		Now:  exceptionsFixedNow(),
	})
	require.NoError(t, err)
	require.Len(t, res.Entries, 2)
	require.Empty(t, res.Warnings, "both fixture entries use known FIPS quality gate IDs and a far-future expiry_date")
}

// TestValidateExceptions_PassStatusRejected is the AC #6 "PASS status
// rejection" case, and the literal AC #4 requirement: running the validator
// against a fixture with exception_status: PASS must exit with an error
// containing "EXCEPTION entries must never have status PASS".
func TestValidateExceptions_PassStatusRejected(t *testing.T) {
	res, err := ValidateExceptions(&ValidateExceptionsReq{
		Path: exceptionsTestdata("invalid-pass-status.json"),
		Now:  exceptionsFixedNow(),
	})
	require.Error(t, err)
	require.Nil(t, res)
	require.Contains(t, err.Error(), "EXCEPTION entries must never have status PASS")
}

// TestValidateExceptions_ExpiredExceptionWarns is the AC #6 "expired
// exception warning" case, and error_handling: "Expired exceptions produce
// warnings (exit code 0) ... for re-evaluation" -- validation must still
// succeed.
func TestValidateExceptions_ExpiredExceptionWarns(t *testing.T) {
	res, err := ValidateExceptions(&ValidateExceptionsReq{
		Path: exceptionsTestdata("expired-exception.json"),
		Now:  exceptionsFixedNow(),
	})
	require.NoError(t, err)
	require.Len(t, res.Entries, 1)
	require.Len(t, res.Warnings, 1)
	require.Contains(t, res.Warnings[0], "FIPS-CRYPTO-002")
	require.Contains(t, res.Warnings[0], "expired")
	require.Contains(t, res.Warnings[0], "re-evaluated")
}

// TestValidateExceptions_MissingFieldsRejected is the AC #6 "missing
// required fields" case.
func TestValidateExceptions_MissingFieldsRejected(t *testing.T) {
	res, err := ValidateExceptions(&ValidateExceptionsReq{
		Path: exceptionsTestdata("missing-fields.json"),
		Now:  exceptionsFixedNow(),
	})
	require.Error(t, err)
	require.Nil(t, res)
	require.Contains(t, err.Error(), `missing required field "owner"`)
	require.Contains(t, err.Error(), `missing required field "justification"`)
	require.Contains(t, err.Error(), `missing required field "jira_reference"`)
}

// TestValidateExceptions_MalformedJSONRejected is the AC #6 "malformed JSON"
// case, and error_handling: "the validator reports the parse error with
// line/column information."
func TestValidateExceptions_MalformedJSONRejected(t *testing.T) {
	tmpDir := t.TempDir()
	malformed := filepath.Join(tmpDir, "malformed.json")
	require.NoError(t, os.WriteFile(malformed, []byte(`[{"finding_id": "GO-2026-6091",`), 0o644))

	res, err := ValidateExceptions(&ValidateExceptionsReq{Path: malformed})
	require.Error(t, err)
	require.Nil(t, res)
	require.Contains(t, err.Error(), "not valid JSON")
	require.Contains(t, err.Error(), "line")
	require.Contains(t, err.Error(), "column")
}

// TestValidateExceptions_MissingFile_ReturnsError covers error_handling: "If
// exceptions.json is missing, the validator exits with error code 1 and a
// message identifying the expected path."
func TestValidateExceptions_MissingFile_ReturnsError(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "does-not-exist.json")
	res, err := ValidateExceptions(&ValidateExceptionsReq{Path: missing})
	require.Error(t, err)
	require.Nil(t, res)
	require.Contains(t, err.Error(), missing)
}

func TestValidateExceptions_RequiresPath(t *testing.T) {
	_, err := ValidateExceptions(&ValidateExceptionsReq{})
	require.Error(t, err)

	_, err = ValidateExceptions(nil)
	require.Error(t, err)
}

// TestValidateExceptions_EmptyArray covers edge_cases: "The exceptions.json
// file is empty (empty array []) -- the validator should pass with no
// findings."
func TestValidateExceptions_EmptyArray(t *testing.T) {
	tmpDir := t.TempDir()
	empty := filepath.Join(tmpDir, "empty.json")
	require.NoError(t, os.WriteFile(empty, []byte(`[]`), 0o644))

	res, err := ValidateExceptions(&ValidateExceptionsReq{Path: empty})
	require.NoError(t, err)
	require.Empty(t, res.Entries)
	require.Empty(t, res.Warnings)
}

// TestValidateExceptions_DuplicateFindingID covers edge_cases: "Multiple
// exception entries reference the same finding_id -- the validator should
// warn about duplicates but not fail."
func TestValidateExceptions_DuplicateFindingID(t *testing.T) {
	tmpDir := t.TempDir()
	dup := filepath.Join(tmpDir, "dup.json")
	entry := `{
		"finding_id": "FIPS-CRYPTO-002",
		"original_status": "FAIL",
		"exception_status": "EXCEPTION",
		"owner": "security-team",
		"justification": "duplicate test entry",
		"expiry_date": "2099-12-31",
		"jira_reference": "PSP-3913",
		"created_at": "2026-01-01T00:00:00Z"
	}`
	require.NoError(t, os.WriteFile(dup, []byte("["+entry+","+entry+"]"), 0o644))

	res, err := ValidateExceptions(&ValidateExceptionsReq{Path: dup, Now: exceptionsFixedNow()})
	require.NoError(t, err)
	require.Len(t, res.Entries, 2)
	require.Len(t, res.Warnings, 1)
	require.Contains(t, res.Warnings[0], `"FIPS-CRYPTO-002" appears 2 times`)
}

// TestValidateExceptions_UnknownFindingIDWarns covers edge_cases: "A
// finding_id in exceptions.json does not match any known FIPS quality gate
// ID -- the validator should warn but not fail, as the finding may come
// from an external scanner."
func TestValidateExceptions_UnknownFindingIDWarns(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "external-scanner.json")
	require.NoError(t, os.WriteFile(path, []byte(`[{
		"finding_id": "GO-2026-6091",
		"original_status": "FAIL",
		"exception_status": "EXCEPTION",
		"owner": "security-team",
		"justification": "external scanner finding",
		"expiry_date": "2099-12-31",
		"jira_reference": "PSP-3913",
		"created_at": "2026-01-01T00:00:00Z"
	}]`), 0o644))

	res, err := ValidateExceptions(&ValidateExceptionsReq{Path: path, Now: exceptionsFixedNow()})
	require.NoError(t, err)
	require.Len(t, res.Warnings, 1)
	require.Contains(t, res.Warnings[0], "does not match any known FIPS quality gate ID")
}

// TestValidateExceptions_ExpiryEqualToToday_NotExpired covers edge_cases:
// "An exception entry has an expiry_date exactly equal to today -- the
// validator should treat this as not-yet-expired (expiry is exclusive of
// the date itself)."
func TestValidateExceptions_ExpiryEqualToToday_NotExpired(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "expires-today.json")
	require.NoError(t, os.WriteFile(path, []byte(`[{
		"finding_id": "FIPS-CRYPTO-002",
		"original_status": "REVIEW",
		"exception_status": "EXCEPTION",
		"owner": "security-team",
		"justification": "expires exactly today",
		"expiry_date": "2026-09-27",
		"jira_reference": "PSP-3913",
		"created_at": "2026-01-01T00:00:00Z"
	}]`), 0o644))

	res, err := ValidateExceptions(&ValidateExceptionsReq{Path: path, Now: exceptionsFixedNow()})
	require.NoError(t, err)
	require.Empty(t, res.Warnings, "expiry_date equal to today must not be treated as expired")
}

// TestValidateExceptions_InvalidOriginalStatusRejected covers the AC #1
// schema requirement that original_status must be REVIEW or FAIL.
func TestValidateExceptions_InvalidOriginalStatusRejected(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "bad-original-status.json")
	require.NoError(t, os.WriteFile(path, []byte(`[{
		"finding_id": "GO-2026-6091",
		"original_status": "PASS",
		"exception_status": "EXCEPTION",
		"owner": "security-team",
		"justification": "bad original_status",
		"expiry_date": "2099-12-31",
		"jira_reference": "PSP-3913",
		"created_at": "2026-01-01T00:00:00Z"
	}]`), 0o644))

	_, err := ValidateExceptions(&ValidateExceptionsReq{Path: path})
	require.Error(t, err)
	require.Contains(t, err.Error(), `original_status "PASS" is invalid`)
}

// TestValidateExceptionEntry_MalformedDatesRejected covers invalid
// expiry_date / created_at formatting as a schema violation, distinct from
// the expiry warning check.
func TestValidateExceptionEntry_MalformedDatesRejected(t *testing.T) {
	e := ExceptionEntry{
		FindingID:       "GO-2026-6091",
		OriginalStatus:  excOriginalStatusFail,
		ExceptionStatus: excStatusException,
		Owner:           "security-team",
		Justification:   "bad dates",
		ExpiryDate:      "not-a-date",
		JiraReference:   "PSP-3913",
		CreatedAt:       "also-not-a-date",
	}
	errs := validateExceptionEntry(e, 0)
	require.Len(t, errs, 2)
	require.Contains(t, errs[0], "expiry_date")
	require.Contains(t, errs[1], "created_at")
}

// TestValidateExceptionsCmd_ExitsOnPassStatus exercises the cobra command
// end-to-end, matching the literal AC #4 wording: "Running the validation
// script against a test fixture containing an entry with exception_status:
// PASS exits with error code 1."
func TestValidateExceptionsCmd_ExitsOnPassStatus(t *testing.T) {
	rootCfg.repoRoot = ""
	cmd := newValidateExceptionsCmd()
	suppressOutput(t, cmd)
	cmd.SetArgs([]string{exceptionsTestdata("invalid-pass-status.json")})

	err := cmd.Execute()
	require.Error(t, err)
	require.Contains(t, err.Error(), "EXCEPTION entries must never have status PASS")
}

func TestValidateExceptionsCmd_ValidFileSucceeds(t *testing.T) {
	rootCfg.repoRoot = ""
	cmd := newValidateExceptionsCmd()
	suppressOutput(t, cmd)
	cmd.SetArgs([]string{exceptionsTestdata("valid-exceptions.json")})

	require.NoError(t, cmd.Execute())
}
