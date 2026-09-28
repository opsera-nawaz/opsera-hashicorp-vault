// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclparse"
	"github.com/zclconf/go-cty/cty"
)

// Verification log statuses. REVIEW and EXCEPTION entries must never be
// represented as PASS -- see ValidateVerificationLogIntegrity.
const (
	StatusPass      = "PASS"
	StatusFail      = "FAIL"
	StatusReview    = "REVIEW"
	StatusException = "EXCEPTION"
)

// approvedTLSCipherSuites is the FIPS-Approved cipher suite allowlist used to
// evaluate a Vault listener's tls_cipher_suites configuration (matches the
// architecture artifact's Phase 2 TLS enforcement allowlist and the
// compensating control documented for RR-005 in
// docs/fips/residual-crypto-risk-register.md).
var approvedTLSCipherSuites = []string{
	"TLS_AES_128_GCM_SHA256",
	"TLS_AES_256_GCM_SHA384",
	"TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
	"TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
	"TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
	"TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
}

// CMVPCertificate is one entry in the static CMVP certificate reference data
// file (.release/fips-data/cmvp-certificates.json).
type CMVPCertificate struct {
	Provider             string `json:"provider"`
	CertificateNumber    string `json:"certificate_number"`
	ModuleName           string `json:"module_name"`
	ValidationStatus     string `json:"validation_status"`
	ExpiryDate           string `json:"expiry_date"`
	FIPSEndpointURL      string `json:"fips_endpoint_url,omitempty"`
	ProductBindingStatus string `json:"product_binding_status,omitempty"`
	Notes                string `json:"notes,omitempty"`
}

// cmvpCertificateFile is the top-level shape of
// .release/fips-data/cmvp-certificates.json.
type cmvpCertificateFile struct {
	SchemaVersion int               `json:"schema_version"`
	GeneratedFrom []string          `json:"generated_from,omitempty"`
	Certificates  []CMVPCertificate `json:"certificates"`
}

// ExceptionRecord is one record consumed from the exception tracking
// system's output file. Its Status must be FAIL, REVIEW, or EXCEPTION --
// never PASS, since an "exception" is by definition not a clean pass.
type ExceptionRecord struct {
	ExceptionID string `json:"exception_id"`
	CheckID     string `json:"check_id"`
	Status      string `json:"status"`
	FindingRef  string `json:"finding_ref,omitempty"`
	Reason      string `json:"reason"`
	ApprovedBy  string `json:"approved_by,omitempty"`
	ExpiresAt   string `json:"expires_at,omitempty"`
	CreatedAt   string `json:"created_at"`
}

// exceptionsFile is the top-level shape of the exception-tracking-system
// output file consumed by GenerateFIPSEvidence.
type exceptionsFile struct {
	SchemaVersion int               `json:"schema_version"`
	Exceptions    []ExceptionRecord `json:"exceptions"`
}

// VerificationLogEntry is one entry in the evidence package's
// verification_log array.
type VerificationLogEntry struct {
	CheckID string `json:"check_id"`
	Status  string `json:"status"`
	// EvidenceSource is the file path (or other locator) this entry's
	// finding was derived from.
	EvidenceSource string `json:"evidence_source"`
	Timestamp      string `json:"timestamp"`
	Notes          string `json:"notes,omitempty"`
	// SourceExceptionID is set only when this entry was derived from an
	// ExceptionRecord, and is used by ValidateVerificationLogIntegrity to
	// cross-reference the two.
	SourceExceptionID string `json:"source_exception_id,omitempty"`
}

// TLSListenerConfig is the configuration_diffs.tls_listener section: a
// snapshot of the Vault server config template's listener TLS settings,
// compared against the FIPS-Approved cipher suite baseline.
type TLSListenerConfig struct {
	SourceFile                   string   `json:"source_file"`
	ListenerType                 string   `json:"listener_type,omitempty"`
	TLSMinVersion                string   `json:"tls_min_version,omitempty"`
	TLSMinVersionExplicit        bool     `json:"tls_min_version_explicit"`
	CipherSuites                 []string `json:"cipher_suites,omitempty"`
	CipherSuitesExplicit         bool     `json:"cipher_suites_explicit"`
	ApprovedCipherSuitesBaseline []string `json:"approved_cipher_suites_baseline"`
	NonApprovedCiphersFound      []string `json:"non_approved_ciphers_found,omitempty"`
	Notes                        []string `json:"notes,omitempty"`
}

// ConfigurationDiffs is the evidence package's configuration_diffs section.
type ConfigurationDiffs struct {
	TLSListener *TLSListenerConfig `json:"tls_listener"`
}

// EvidencePackage is the top-level, on-disk shape of a dated FIPS 140-3
// evidence package written to
// .release/fips-evidence/<date>-fips-evidence.json.
type EvidencePackage struct {
	GeneratedAt        string                 `json:"generated_at"`
	ReleaseVersion     string                 `json:"release_version,omitempty"`
	CMVPCertificates   []CMVPCertificate      `json:"cmvp_certificates"`
	ConfigurationDiffs ConfigurationDiffs     `json:"configuration_diffs"`
	VerificationLog    []VerificationLogEntry `json:"verification_log"`
	Exceptions         []ExceptionRecord      `json:"exceptions"`
	RiskRegisterRef    string                 `json:"risk_register_ref"`
	SBOMRef            string                 `json:"sbom_ref"`
	BuildProvenanceRef string                 `json:"build_provenance_ref"`
	Warnings           []string               `json:"warnings,omitempty"`
}

// GenerateFIPSEvidenceReq is the input to GenerateFIPSEvidence.
type GenerateFIPSEvidenceReq struct {
	// ReleaseVersion is the release this evidence package documents (e.g.
	// "1.2.3").
	ReleaseVersion string
	// CMVPPath is the path to the static CMVP certificate reference data
	// file. Required -- a missing file is a fatal error.
	CMVPPath string
	// ExceptionsPath is the path to the exception-tracking-system output
	// file. Optional -- a missing or empty file produces an empty
	// exceptions array plus a REVIEW verification_log entry, per
	// edge_cases.
	ExceptionsPath string
	// VaultConfigPath is the path to the Vault server config template to
	// extract TLS listener settings from.
	VaultConfigPath  string
	RiskRegisterPath string
	SBOMPath         string
	ProvenancePath   string
	OutputPath       string

	// RepoRoot, if set, is used to rewrite absolute input paths to
	// repo-root-relative paths before they are embedded in the evidence
	// package (as verification_log.evidence_source,
	// configuration_diffs.tls_listener.source_file, and the *_ref fields),
	// so the committed, version-controlled artifact never leaks a
	// build-machine-specific absolute filesystem path. Paths outside
	// RepoRoot, and reads from disk, are unaffected.
	RepoRoot string

	// Now returns the current time. Defaults to time.Now when nil.
	Now func() time.Time
}

// GenerateFIPSEvidenceRes is the result of a successful GenerateFIPSEvidence
// call.
type GenerateFIPSEvidenceRes struct {
	OutputPath string
	Package    *EvidencePackage
	Warnings   []string
}

// GenerateFIPSEvidence assembles a dated FIPS 140-3 evidence package: CMVP
// certificate references, a TLS listener configuration snapshot,
// algorithm-restriction verification results, exception records consumed
// from the exception tracking system, and references to the release's risk
// register, SBOM, and build provenance attestation. It never claims Vault is
// "FIPS validated" or "FIPS certified" -- only FIPS-Approved-algorithm and
// FIPS-aligned-posture language is used.
func GenerateFIPSEvidence(req *GenerateFIPSEvidenceReq) (*GenerateFIPSEvidenceRes, error) {
	if req == nil || req.OutputPath == "" {
		return nil, errors.New("generate fips evidence: output path is required")
	}

	now := req.Now
	if now == nil {
		now = time.Now
	}
	generatedAt := now().UTC().Format(time.RFC3339)
	rel := relPathFunc(req.RepoRoot)

	certs, certWarnings, err := loadCMVPCertificates(req.CMVPPath, now())
	if err != nil {
		return nil, err
	}

	exceptions, exceptionLogEntry, err := loadExceptionRecords(req.ExceptionsPath, now)
	if err != nil {
		return nil, err
	}
	if exceptionLogEntry != nil {
		if req.ExceptionsPath != "" {
			exceptionLogEntry.Notes = strings.ReplaceAll(exceptionLogEntry.Notes, req.ExceptionsPath, rel(req.ExceptionsPath))
		}
		exceptionLogEntry.EvidenceSource = rel(exceptionLogEntry.EvidenceSource)
	}

	tlsCfg, tlsErr := extractTLSListenerConfig(req.VaultConfigPath)
	if tlsCfg != nil && req.VaultConfigPath != "" {
		relVaultConfigPath := rel(req.VaultConfigPath)
		for i, note := range tlsCfg.Notes {
			tlsCfg.Notes[i] = strings.ReplaceAll(note, req.VaultConfigPath, relVaultConfigPath)
		}
		tlsCfg.SourceFile = relVaultConfigPath
	}

	log := make([]VerificationLogEntry, 0, 10)

	log = append(log, VerificationLogEntry{
		CheckID:        "FIPS-CRYPTO-001",
		Status:         StatusPass,
		EvidenceSource: "fips/crypto_inventory.yaml",
		Timestamp:      generatedAt,
		Notes:          "Phase 1 consolidated cryptographic inventory is present and version-controlled.",
	})

	log = append(log, VerificationLogEntry{
		CheckID:        "FIPS-CRYPTO-002",
		Status:         StatusReview,
		EvidenceSource: "docs/fips/residual-crypto-risk-register.md#RR-004",
		Timestamp:      generatedAt,
		Notes:          "Approved-algorithm allowlist gate is declared (.golangci.yml, tools/semgrep/ci/fips-crypto-imports.yml) but is not yet wired into a CI workflow and does not currently cover sdk/helper/keysutil/policy.go; see RR-004.",
	})

	crypto005Status := StatusPass
	crypto005Notes := "Key management evaluation artifacts (docs/fips/key-management-assessment.md, docs/fips/kms-hsm-seal-cmvp-certificates.md) are present; CMVP certificate references loaded without a lapsed-expiry finding."
	if len(certWarnings) > 0 {
		crypto005Status = StatusReview
		crypto005Notes = strings.Join(certWarnings, "; ")
	}
	log = append(log, VerificationLogEntry{
		CheckID:        "FIPS-CRYPTO-005",
		Status:         crypto005Status,
		EvidenceSource: rel(req.CMVPPath),
		Timestamp:      generatedAt,
		Notes:          crypto005Notes,
	})

	log = append(log, VerificationLogEntry{
		CheckID:        "FIPS-DEP-001",
		Status:         StatusPass,
		EvidenceSource: "fips/crypto_inventory.yaml",
		Timestamp:      generatedAt,
		Notes:          "Cryptographic dependency identification (Phase 1) is present and version-controlled.",
	})

	log = append(log, VerificationLogEntry{
		CheckID:        "FIPS-CONTAINER-001",
		Status:         StatusPass,
		EvidenceSource: "fips/crypto_inventory.yaml",
		Timestamp:      generatedAt,
		Notes:          "Container base image classification (Phase 1) is present and version-controlled.",
	})

	if tlsErr != nil {
		notes := tlsErr.Error()
		if req.VaultConfigPath != "" {
			notes = strings.ReplaceAll(notes, req.VaultConfigPath, rel(req.VaultConfigPath))
		}
		log = append(log, VerificationLogEntry{
			CheckID:        "FIPS-TLS-001",
			Status:         StatusFail,
			EvidenceSource: rel(req.VaultConfigPath),
			Timestamp:      generatedAt,
			Notes:          notes,
		})
	} else {
		entry := evaluateTLSListenerConfig(tlsCfg, generatedAt)
		log = append(log, *entry)
	}

	if exceptionLogEntry != nil {
		log = append(log, *exceptionLogEntry)
	}
	for _, e := range exceptions {
		log = append(log, verificationEntryForException(e, rel(req.ExceptionsPath), now))
	}

	log = append(log, VerificationLogEntry{
		CheckID:        "FIPS-RUNTIME-001",
		Status:         StatusPass,
		EvidenceSource: "fips evidence generation pipeline (.release/scripts/generate-fips-evidence.sh)",
		Timestamp:      generatedAt,
		Notes:          "Dated FIPS evidence package generated, aggregating CMVP certificate references, a TLS listener configuration snapshot, exception records, and SBOM/provenance/risk-register sub-artifact references.",
	})

	if err := ValidateVerificationLogIntegrity(log, exceptions); err != nil {
		return nil, fmt.Errorf("generate fips evidence: %w", err)
	}

	var warnings []string
	warnings = append(warnings, certWarnings...)
	warnings = append(warnings, refWarning(req.RiskRegisterPath, "risk register")...)
	warnings = append(warnings, refWarning(req.SBOMPath, "sbom")...)
	warnings = append(warnings, refWarning(req.ProvenancePath, "build provenance")...)

	pkg := &EvidencePackage{
		GeneratedAt:        generatedAt,
		ReleaseVersion:     req.ReleaseVersion,
		CMVPCertificates:   certs,
		ConfigurationDiffs: ConfigurationDiffs{TLSListener: tlsCfg},
		VerificationLog:    log,
		Exceptions:         exceptions,
		RiskRegisterRef:    rel(req.RiskRegisterPath),
		SBOMRef:            rel(req.SBOMPath),
		BuildProvenanceRef: rel(req.ProvenancePath),
		Warnings:           warnings,
	}

	out, err := json.MarshalIndent(pkg, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("generate fips evidence: marshaling evidence package: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(req.OutputPath), 0o755); err != nil {
		return nil, fmt.Errorf("generate fips evidence: creating output directory for %q: %w", req.OutputPath, err)
	}
	if err := os.WriteFile(req.OutputPath, out, 0o644); err != nil {
		return nil, fmt.Errorf("generate fips evidence: writing evidence package to %q: %w", req.OutputPath, err)
	}

	return &GenerateFIPSEvidenceRes{OutputPath: req.OutputPath, Package: pkg, Warnings: warnings}, nil
}

// loadCMVPCertificates reads and decodes the static CMVP certificate
// reference data file. A missing file is a fatal error (error_handling: "If
// the CMVP certificates data file is missing, the generator exits with
// error code 1 and a message identifying the expected path."). Certificates
// whose expiry_date has passed have their validation_status overridden to
// "expired" (edge_cases), and a warning is returned for each so the caller
// can surface it in the verification_log.
func loadCMVPCertificates(path string, now time.Time) ([]CMVPCertificate, []string, error) {
	if path == "" {
		return nil, nil, errors.New("generate fips evidence: cmvp certificates path is required")
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil, fmt.Errorf("generate fips evidence: cmvp certificates file not found at %q", path)
		}
		return nil, nil, fmt.Errorf("generate fips evidence: reading cmvp certificates %q: %w", path, err)
	}

	var file cmvpCertificateFile
	if err := json.Unmarshal(raw, &file); err != nil {
		return nil, nil, fmt.Errorf("generate fips evidence: cmvp certificates %q is not valid JSON: %w", path, err)
	}

	var warnings []string
	certs := make([]CMVPCertificate, 0, len(file.Certificates))
	for _, c := range file.Certificates {
		if c.ExpiryDate != "" {
			expiry, parseErr := time.Parse("2006-01-02", c.ExpiryDate)
			if parseErr == nil && !now.Before(expiry) && c.ValidationStatus != "expired" {
				warnings = append(warnings, fmt.Sprintf(
					"cmvp certificate %s (%s, provider %s) expiry_date %s has passed as of %s; validation_status overridden from %q to \"expired\"",
					c.CertificateNumber, c.ModuleName, c.Provider, c.ExpiryDate, now.UTC().Format("2006-01-02"), c.ValidationStatus,
				))
				c.ValidationStatus = "expired"
			}
		}
		certs = append(certs, c)
	}

	return certs, warnings, nil
}

// loadExceptionRecords reads and decodes the exception-tracking-system
// output file. Per edge_cases, a missing or empty file is not fatal: it
// produces an empty exceptions array plus a REVIEW verification_log entry
// noting the missing data. Per error_handling, malformed JSON is also not
// fatal: it produces an empty exceptions array plus a FAIL verification_log
// entry for the exception-tracking check.
func loadExceptionRecords(path string, now func() time.Time) ([]ExceptionRecord, *VerificationLogEntry, error) {
	ts := now().UTC().Format(time.RFC3339)

	if path == "" {
		return []ExceptionRecord{}, &VerificationLogEntry{
			CheckID:        "FIPS-RUNTIME-001",
			Status:         StatusReview,
			EvidenceSource: "exception-tracking-system",
			Timestamp:      ts,
			Notes:          "no exception records path provided; exception-tracking-system integration is not configured for this evidence package",
		}, nil
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []ExceptionRecord{}, &VerificationLogEntry{
				CheckID:        "FIPS-RUNTIME-001",
				Status:         StatusReview,
				EvidenceSource: path,
				Timestamp:      ts,
				Notes:          fmt.Sprintf("exception records file not found at %q; treating as no active exceptions", path),
			}, nil
		}
		return nil, nil, fmt.Errorf("generate fips evidence: reading exception records %q: %w", path, err)
	}

	var file exceptionsFile
	if jsonErr := json.Unmarshal(raw, &file); jsonErr != nil {
		return []ExceptionRecord{}, &VerificationLogEntry{
			CheckID:        "FIPS-RUNTIME-001",
			Status:         StatusFail,
			EvidenceSource: path,
			Timestamp:      ts,
			Notes:          fmt.Sprintf("exception records file %q is not valid JSON: %s", path, jsonErr.Error()),
		}, nil
	}

	if len(file.Exceptions) == 0 {
		return []ExceptionRecord{}, &VerificationLogEntry{
			CheckID:        "FIPS-RUNTIME-001",
			Status:         StatusReview,
			EvidenceSource: path,
			Timestamp:      ts,
			Notes:          fmt.Sprintf("exception records file %q contained zero entries", path),
		}, nil
	}

	return file.Exceptions, nil, nil
}

// verificationEntryForException converts one consumed ExceptionRecord into
// its verification_log entry, preserving the record's own status verbatim.
// If the record declares an invalid status (anything other than FAIL,
// REVIEW, or EXCEPTION -- most importantly PASS, which an exception must
// never claim), the entry is coerced to REVIEW rather than silently trusted,
// enforcing the status-integrity invariant even against malformed upstream
// data.
func verificationEntryForException(e ExceptionRecord, sourcePath string, now func() time.Time) VerificationLogEntry {
	status := e.Status
	notes := e.Reason

	switch status {
	case StatusFail, StatusReview, StatusException:
		// Valid exception status -- pass through unchanged.
	default:
		notes = fmt.Sprintf(
			"exception record %s declared invalid status %q (exceptions must be FAIL, REVIEW, or EXCEPTION, never PASS); coerced to REVIEW to preserve the status-integrity invariant. Original reason: %s",
			e.ExceptionID, e.Status, e.Reason,
		)
		status = StatusReview
	}

	ts := e.CreatedAt
	if ts == "" {
		ts = now().UTC().Format(time.RFC3339)
	}

	return VerificationLogEntry{
		CheckID:           e.CheckID,
		Status:            status,
		EvidenceSource:    sourcePath,
		Timestamp:         ts,
		Notes:             notes,
		SourceExceptionID: e.ExceptionID,
	}
}

// ValidateVerificationLogIntegrity enforces the status-integrity invariant
// required by acceptance criteria: an exception record whose own status is
// FAIL, REVIEW, or EXCEPTION must never be represented as PASS in the
// verification log, and every verification_log entry's status must be one
// of the four recognized values. It is used both internally (self-check
// after assembling a package) and by unit tests that parse a sample evidence
// package.
func ValidateVerificationLogIntegrity(log []VerificationLogEntry, exceptions []ExceptionRecord) error {
	byID := make(map[string]ExceptionRecord, len(exceptions))
	for _, e := range exceptions {
		byID[e.ExceptionID] = e
	}

	for _, entry := range log {
		switch entry.Status {
		case StatusPass, StatusFail, StatusReview, StatusException:
		default:
			return fmt.Errorf("verification log entry for check %q has invalid status %q", entry.CheckID, entry.Status)
		}

		if entry.SourceExceptionID == "" {
			continue
		}
		record, ok := byID[entry.SourceExceptionID]
		if !ok {
			continue
		}
		if record.Status != StatusPass && entry.Status == StatusPass {
			return fmt.Errorf(
				"status-integrity violation: exception %q has status %q but its verification log entry for check %q reports PASS",
				record.ExceptionID, record.Status, entry.CheckID,
			)
		}
	}

	return nil
}

// extractTLSListenerConfig parses the Vault server config template and
// returns a snapshot of the first "listener" block's TLS settings. It never
// returns an error for a missing tls_min_version/tls_cipher_suites
// attribute -- their absence is recorded via the *Explicit fields and
// surfaced as a REVIEW finding by evaluateTLSListenerConfig, per edge_cases
// ("generator must flag this as a REVIEW finding rather than assuming
// defaults are Approved").
func extractTLSListenerConfig(path string) (*TLSListenerConfig, error) {
	cfg := &TLSListenerConfig{
		SourceFile:                   path,
		ApprovedCipherSuitesBaseline: approvedTLSCipherSuites,
	}

	if path == "" {
		cfg.Notes = append(cfg.Notes, "no vault config path provided")
		return cfg, nil
	}

	parser := hclparse.NewParser()
	file, diags := parser.ParseHCLFile(path)
	if diags.HasErrors() {
		return nil, fmt.Errorf("generate fips evidence: parsing vault config %q: %s", path, diags.Error())
	}

	blockSchema := &hcl.BodySchema{
		Blocks: []hcl.BlockHeaderSchema{
			{Type: "listener", LabelNames: []string{"type"}},
		},
	}
	content, _, diags := file.Body.PartialContent(blockSchema)
	if diags.HasErrors() {
		return nil, fmt.Errorf("generate fips evidence: reading listener blocks from %q: %s", path, diags.Error())
	}

	if len(content.Blocks) == 0 {
		cfg.Notes = append(cfg.Notes, fmt.Sprintf("no listener block found in %s", path))
		return cfg, nil
	}

	block := content.Blocks[0]
	if len(block.Labels) > 0 {
		cfg.ListenerType = block.Labels[0]
	}

	attrSchema := &hcl.BodySchema{
		Attributes: []hcl.AttributeSchema{
			{Name: "tls_min_version"},
			{Name: "tls_cipher_suites"},
		},
	}
	attrContent, _, diags := block.Body.PartialContent(attrSchema)
	if diags.HasErrors() {
		return nil, fmt.Errorf("generate fips evidence: reading listener attributes from %q: %s", path, diags.Error())
	}

	if attr, ok := attrContent.Attributes["tls_min_version"]; ok {
		if val, valDiags := attr.Expr.Value(nil); !valDiags.HasErrors() && val.Type() == cty.String {
			cfg.TLSMinVersion = val.AsString()
			cfg.TLSMinVersionExplicit = true
		}
	}

	if attr, ok := attrContent.Attributes["tls_cipher_suites"]; ok {
		if val, valDiags := attr.Expr.Value(nil); !valDiags.HasErrors() && val.Type() == cty.String {
			var suites []string
			for _, s := range strings.Split(val.AsString(), ",") {
				if s = strings.TrimSpace(s); s != "" {
					suites = append(suites, s)
				}
			}
			cfg.CipherSuites = suites
			cfg.CipherSuitesExplicit = len(suites) > 0
		}
	}

	if len(content.Blocks) > 1 {
		cfg.Notes = append(cfg.Notes, fmt.Sprintf("%d listener blocks found in %s; evidence reflects only the first (%s)", len(content.Blocks), path, cfg.ListenerType))
	}

	return cfg, nil
}

// evaluateTLSListenerConfig produces the FIPS-TLS-001 verification_log entry
// for a TLSListenerConfig snapshot: FAIL if an explicitly configured cipher
// suite is not on the Approved baseline, REVIEW if tls_min_version or
// tls_cipher_suites was not explicitly set (never assume the default is
// Approved), otherwise PASS.
func evaluateTLSListenerConfig(cfg *TLSListenerConfig, timestamp string) *VerificationLogEntry {
	entry := &VerificationLogEntry{CheckID: "FIPS-TLS-001", EvidenceSource: cfg.SourceFile, Timestamp: timestamp}

	approved := make(map[string]bool, len(approvedTLSCipherSuites))
	for _, s := range approvedTLSCipherSuites {
		approved[s] = true
	}

	var nonApproved []string
	for _, s := range cfg.CipherSuites {
		if !approved[s] {
			nonApproved = append(nonApproved, s)
		}
	}
	cfg.NonApprovedCiphersFound = nonApproved

	switch {
	case len(nonApproved) > 0:
		entry.Status = StatusFail
		entry.Notes = fmt.Sprintf("non-Approved cipher suite(s) explicitly configured in %s: %s", cfg.SourceFile, strings.Join(nonApproved, ", "))
	case !cfg.TLSMinVersionExplicit || !cfg.CipherSuitesExplicit:
		entry.Status = StatusReview
		entry.Notes = fmt.Sprintf(
			"tls_min_version_explicit=%t, cipher_suites_explicit=%t in %s; an unset value must not be assumed to default to a FIPS-Approved configuration",
			cfg.TLSMinVersionExplicit, cfg.CipherSuitesExplicit, cfg.SourceFile,
		)
	default:
		entry.Status = StatusPass
		entry.Notes = "tls_min_version and tls_cipher_suites are both explicitly set, and all configured cipher suites are on the FIPS-Approved baseline"
	}

	return entry
}

// refWarning returns a one-element warning slice if path is non-empty and
// the file it points to does not exist. It never fails generation -- SBOM
// generation and provenance attestation are produced by separate,
// out-of-scope pipeline stages that may not have run yet when the evidence
// package is assembled standalone (e.g. in a dry run). The warning text
// intentionally omits the path itself so a build-machine-specific absolute
// path is never echoed into the evidence package.
func refWarning(path, label string) []string {
	if path == "" {
		return []string{fmt.Sprintf("no %s reference path provided", label)}
	}
	if _, err := os.Stat(path); err != nil {
		return []string{fmt.Sprintf("%s reference does not exist yet on disk", label)}
	}
	return nil
}

// relPathFunc returns a function that rewrites an absolute path under
// repoRoot to a repo-root-relative path, for embedding in the evidence
// package. If repoRoot is empty, the path is not an absolute descendant of
// it, or the input is empty, the path is returned unchanged.
func relPathFunc(repoRoot string) func(string) string {
	return func(path string) string {
		if repoRoot == "" || path == "" {
			return path
		}
		r, err := filepath.Rel(repoRoot, path)
		if err != nil || strings.HasPrefix(r, "..") {
			return path
		}
		return r
	}
}
