// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

// excStatusException is the only value exception_status may ever take.
// excOriginalStatusReview and excOriginalStatusFail are the only values
// original_status may take -- an exception is only meaningful for a finding
// that was not already a clean PASS.
const (
	excStatusException      = "EXCEPTION"
	excOriginalStatusReview = "REVIEW"
	excOriginalStatusFail   = "FAIL"
)

// knownFIPSQualityGateIDs are the FIPS quality gate check IDs produced by
// this repository's own CI gates (docs/fips/residual-crypto-risk-register.md
// "Quality gate ID note" confirms FIPS-CRYPTO-003/004 do not exist, and
// tools/pipeline's FIPS evidence generator emits FIPS-DEP-001,
// FIPS-CONTAINER-001, FIPS-TLS-001, and FIPS-RUNTIME-001 in addition to the
// FIPS-CRYPTO-* family). A finding_id that is not one of these is presumed
// to come from an external scanner (e.g. a Go vulnerability database ID like
// GO-2026-6091) -- per edge_cases that is a warning, not an error.
var knownFIPSQualityGateIDs = map[string]bool{
	"FIPS-CRYPTO-001":    true,
	"FIPS-CRYPTO-002":    true,
	"FIPS-CRYPTO-005":    true,
	"FIPS-DEP-001":       true,
	"FIPS-CONTAINER-001": true,
	"FIPS-TLS-001":       true,
	"FIPS-RUNTIME-001":   true,
}

// ExceptionEntry is one record in the structured FIPS exception registry at
// .release/fips-data/exceptions.json (schema:
// .release/fips-data/exceptions-schema.json). It formally tracks a REVIEW or
// FAIL FIPS finding that has been explicitly acknowledged as an accepted
// risk -- with an owner, justification, and expiry date -- so it can be
// tracked and re-evaluated rather than only narratively documented (e.g. in
// docs/fips/residual-crypto-risk-register.md) or silently converted to PASS.
type ExceptionEntry struct {
	FindingID       string `json:"finding_id"`
	OriginalStatus  string `json:"original_status"`
	ExceptionStatus string `json:"exception_status"`
	Owner           string `json:"owner"`
	Justification   string `json:"justification"`
	ExpiryDate      string `json:"expiry_date"`
	JiraReference   string `json:"jira_reference"`
	CreatedAt       string `json:"created_at"`
}

// ValidateExceptionsReq is the input to ValidateExceptions.
type ValidateExceptionsReq struct {
	// Path is the path to the exceptions registry file: a JSON array of
	// ExceptionEntry. Required.
	Path string
	// Now returns the current time, used to evaluate expiry_date. Defaults
	// to time.Now when nil.
	Now func() time.Time
}

// ValidateExceptionsRes is the result of a successful ValidateExceptions
// call: the registry is schema-valid and the PASS-status invariant holds.
// Warnings never fail validation -- expired exceptions, duplicate
// finding_ids, and finding_ids that don't match a known FIPS quality gate ID
// are all surfaced here (edge_cases; error_handling: "Expired exceptions
// produce warnings (exit code 0) ... for re-evaluation").
type ValidateExceptionsRes struct {
	Path     string
	Entries  []ExceptionEntry
	Warnings []string
}

// ValidateExceptions reads the exception registry at req.Path, validates
// every entry against the required schema (finding_id, original_status,
// exception_status, owner, justification, expiry_date, jira_reference,
// created_at), and enforces the invariant that an entry's exception_status
// must always be EXCEPTION -- never PASS. A missing file, malformed JSON, or
// any schema/invariant violation is a fatal error. Expired exceptions,
// duplicate finding_ids, and finding_ids that don't match a known FIPS
// quality gate ID are reported as non-fatal warnings.
func ValidateExceptions(req *ValidateExceptionsReq) (*ValidateExceptionsRes, error) {
	if req == nil || req.Path == "" {
		return nil, errors.New("validate exceptions: path is required")
	}

	now := req.Now
	if now == nil {
		now = time.Now
	}

	raw, err := os.ReadFile(req.Path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("validate exceptions: exceptions registry not found at %q", req.Path)
		}
		return nil, fmt.Errorf("validate exceptions: reading %q: %w", req.Path, err)
	}

	var entries []ExceptionEntry
	if jsonErr := json.Unmarshal(raw, &entries); jsonErr != nil {
		return nil, fmt.Errorf("validate exceptions: %q is not valid JSON: %w", req.Path, describeJSONError(raw, jsonErr))
	}

	var schemaErrors []string
	for i, e := range entries {
		schemaErrors = append(schemaErrors, validateExceptionEntry(e, i)...)
	}
	if len(schemaErrors) > 0 {
		return nil, fmt.Errorf("validate exceptions: %q failed validation:\n  %s", req.Path, strings.Join(schemaErrors, "\n  "))
	}

	return &ValidateExceptionsRes{
		Path:     req.Path,
		Entries:  entries,
		Warnings: checkExceptionWarnings(entries, now()),
	}, nil
}

// validateExceptionEntry validates one entry against the required schema
// and the PASS-status invariant. Every violation is returned as a distinct,
// finding_id-prefixed message so the caller can report all violating
// entries at once (error_handling: "the validator ... lists all violating
// entries"). The exact text "EXCEPTION entries must never have status PASS"
// is required verbatim by acceptance criteria when exception_status is PASS.
func validateExceptionEntry(e ExceptionEntry, index int) []string {
	label := e.FindingID
	if label == "" {
		label = fmt.Sprintf("entry[%d]", index)
	}

	var errs []string
	requireField := func(name, val string) {
		if strings.TrimSpace(val) == "" {
			errs = append(errs, fmt.Sprintf("%s: missing required field %q", label, name))
		}
	}

	requireField("finding_id", e.FindingID)
	requireField("original_status", e.OriginalStatus)
	requireField("exception_status", e.ExceptionStatus)
	requireField("owner", e.Owner)
	requireField("justification", e.Justification)
	requireField("expiry_date", e.ExpiryDate)
	requireField("jira_reference", e.JiraReference)
	requireField("created_at", e.CreatedAt)

	switch e.ExceptionStatus {
	case "", excStatusException:
		// Empty is already reported by requireField above; EXCEPTION is
		// the only valid non-empty value.
	case "PASS":
		errs = append(errs, fmt.Sprintf("%s: EXCEPTION entries must never have status PASS", label))
	default:
		errs = append(errs, fmt.Sprintf("%s: exception_status %q is invalid; must be %q", label, e.ExceptionStatus, excStatusException))
	}

	switch e.OriginalStatus {
	case "", excOriginalStatusReview, excOriginalStatusFail:
	default:
		errs = append(errs, fmt.Sprintf("%s: original_status %q is invalid; must be %q or %q", label, e.OriginalStatus, excOriginalStatusReview, excOriginalStatusFail))
	}

	if e.ExpiryDate != "" {
		if _, dateErr := parseExceptionDate(e.ExpiryDate); dateErr != nil {
			errs = append(errs, fmt.Sprintf("%s: expiry_date %q is not a valid ISO 8601 date: %s", label, e.ExpiryDate, dateErr))
		}
	}

	if e.CreatedAt != "" {
		if _, dateErr := parseExceptionDate(e.CreatedAt); dateErr != nil {
			errs = append(errs, fmt.Sprintf("%s: created_at %q is not a valid ISO 8601 timestamp: %s", label, e.CreatedAt, dateErr))
		}
	}

	return errs
}

// checkExceptionWarnings evaluates the non-fatal edge_cases: expired
// exceptions, duplicate finding_ids, and finding_ids that don't match a
// known FIPS quality gate ID. None of these fail validation.
func checkExceptionWarnings(entries []ExceptionEntry, now time.Time) []string {
	var warnings []string

	counts := make(map[string]int, len(entries))
	for _, e := range entries {
		if e.FindingID != "" {
			counts[e.FindingID]++
		}
	}
	var dupes []string
	for id, count := range counts {
		if count > 1 {
			dupes = append(dupes, id)
		}
	}
	sort.Strings(dupes)
	for _, id := range dupes {
		warnings = append(warnings, fmt.Sprintf("finding_id %q appears %d times in the exception registry", id, counts[id]))
	}

	for _, e := range entries {
		if e.ExpiryDate == "" {
			continue
		}
		expiry, err := parseExceptionDate(e.ExpiryDate)
		if err != nil {
			continue // already reported as a validation error
		}
		if isExceptionExpired(expiry, now) {
			warnings = append(warnings, fmt.Sprintf(
				"exception %q has expired (expiry_date %s has passed as of %s) and should be re-evaluated",
				e.FindingID, e.ExpiryDate, now.UTC().Format("2006-01-02"),
			))
		}
	}

	for _, e := range entries {
		if e.FindingID != "" && !knownFIPSQualityGateIDs[e.FindingID] {
			warnings = append(warnings, fmt.Sprintf(
				"finding_id %q does not match any known FIPS quality gate ID; assuming it originates from an external scanner",
				e.FindingID,
			))
		}
	}

	return warnings
}

// isExceptionExpired reports whether expiry has passed as of now, comparing
// calendar dates only. Per edge_cases, expiry is exclusive of the date
// itself: an expiry_date equal to today's date is not yet expired.
func isExceptionExpired(expiry, now time.Time) bool {
	e := time.Date(expiry.Year(), expiry.Month(), expiry.Day(), 0, 0, 0, 0, time.UTC)
	n := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	return e.Before(n)
}

// parseExceptionDate parses expiry_date/created_at as either an ISO 8601
// date (YYYY-MM-DD) or a full ISO 8601 / RFC3339 timestamp.
func parseExceptionDate(s string) (time.Time, error) {
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return t, nil
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	return time.Time{}, errors.New("expected an ISO 8601 date (YYYY-MM-DD) or timestamp (RFC3339)")
}

// describeJSONError wraps a JSON decoding error with line/column information
// computed from the error's byte offset, per error_handling: "the validator
// reports the parse error with line/column information."
func describeJSONError(raw []byte, err error) error {
	var syntaxErr *json.SyntaxError
	var typeErr *json.UnmarshalTypeError

	var offset int64
	switch {
	case errors.As(err, &syntaxErr):
		offset = syntaxErr.Offset
	case errors.As(err, &typeErr):
		offset = typeErr.Offset
	default:
		return err
	}

	line, col := lineAndColumnForOffset(raw, offset)
	return fmt.Errorf("%w (line %d, column %d)", err, line, col)
}

// lineAndColumnForOffset converts a byte offset into raw into a 1-indexed
// line and column.
func lineAndColumnForOffset(raw []byte, offset int64) (line, col int) {
	line, col = 1, 1
	for i := int64(0); i < offset && i < int64(len(raw)); i++ {
		if raw[i] == '\n' {
			line++
			col = 1
		} else {
			col++
		}
	}
	return line, col
}

var validateExceptionsReq = &ValidateExceptionsReq{}

func newValidateExceptionsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "validate-exceptions [path]",
		Short: "Validate the FIPS exception registry",
		Long: `Validate the structured FIPS finding exception registry against its
required schema (.release/fips-data/exceptions-schema.json), enforcing that
every entry's exception_status is always EXCEPTION -- never PASS -- and
flagging expired exceptions as warnings for re-evaluation.

Examples:
  # Validate the default registry at .release/fips-data/exceptions.json
  pipeline validate-exceptions

  # Validate a specific file, e.g. a test fixture
  pipeline validate-exceptions tools/pipeline/internal/cmd/testdata/exceptions/valid-exceptions.json`,
		Args: cobra.MaximumNArgs(1),
		RunE: runValidateExceptionsCmd,
	}

	return cmd
}

func runValidateExceptionsCmd(cmd *cobra.Command, args []string) error {
	cmd.SilenceUsage = true // Don't spam the usage on failure

	path := defaultExceptionsPath(rootCfg.repoRoot)
	if len(args) == 1 {
		path = args[0]
	}
	validateExceptionsReq.Path = path

	res, err := ValidateExceptions(validateExceptionsReq)
	if err != nil {
		return fmt.Errorf("validating fips exceptions: %w", err)
	}

	switch rootCfg.format {
	case "json":
		b, jsonErr := json.MarshalIndent(res, "", "  ")
		if jsonErr != nil {
			return jsonErr
		}
		fmt.Println(string(b))
	default:
		fmt.Printf("%s: %d exception(s) validated, 0 PASS-status violations\n", res.Path, len(res.Entries))
		for _, w := range res.Warnings {
			fmt.Printf("warning: %s\n", w)
		}
	}

	return nil
}

// defaultExceptionsPath returns the default exceptions registry path,
// rooted at repoRoot when available.
func defaultExceptionsPath(repoRoot string) string {
	if repoRoot == "" {
		return filepath.Join(".release", "fips-data", "exceptions.json")
	}
	return filepath.Join(repoRoot, ".release", "fips-data", "exceptions.json")
}
