// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package fipsverify

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"testing"

	"github.com/stretchr/testify/require"
)

// rfc3339Regex loosely validates an RFC 3339 UTC timestamp, e.g.
// "2026-09-28T00:00:00Z".
var rfc3339Regex = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$`)

// TestReadOSFIPSEnabled_Enabled covers AC8(1): reading a mock
// /proc/sys/crypto/fips_enabled file whose content is "1" must report 1.
func TestReadOSFIPSEnabled_Enabled(t *testing.T) {
	value, err := readOSFIPSEnabled(filepath.Join("testdata", "fips_enabled_1"))
	require.NoError(t, err)
	require.Equal(t, 1, value)
}

// TestReadOSFIPSEnabled_Disabled covers AC8(1): reading a mock
// /proc/sys/crypto/fips_enabled file whose content is "0" must report 0,
// not an error.
func TestReadOSFIPSEnabled_Disabled(t *testing.T) {
	value, err := readOSFIPSEnabled(filepath.Join("testdata", "fips_enabled_0"))
	require.NoError(t, err)
	require.Equal(t, 0, value)
}

// TestReadOSFIPSEnabled_TrailingWhitespace covers the edge_case that the
// kernel interface may contain a trailing newline: a fixture with a
// trailing newline (testdata/fips_enabled_1, written as "1\n") must still
// parse to the integer 1.
func TestReadOSFIPSEnabled_TrailingWhitespace(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "fips_enabled_1"))
	require.NoError(t, err)
	require.Contains(t, string(raw), "\n", "fixture must exercise the trailing-whitespace edge case")
}

// TestReadOSFIPSEnabled_Missing covers AC8(4): a non-existent path must
// return a descriptive error rather than silently reporting FIPS disabled.
func TestReadOSFIPSEnabled_Missing(t *testing.T) {
	_, err := readOSFIPSEnabled(filepath.Join("testdata", "does-not-exist"))
	require.Error(t, err)
	require.Contains(t, err.Error(), "unable to read FIPS status")
}

// TestReadOSFIPSEnabled_UnexpectedContent covers the error_handling
// requirement that unexpected (non-integer) file content produces a
// descriptive error, not a silent 0.
func TestReadOSFIPSEnabled_UnexpectedContent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "fips_enabled")
	require.NoError(t, os.WriteFile(path, []byte("not-a-number\n"), 0o644))

	_, err := readOSFIPSEnabled(path)
	require.Error(t, err)
	require.Contains(t, err.Error(), "unable to read FIPS status")
}

// TestReadOSFIPSEnabled_DefaultPath covers the default-path behavior: an
// empty procPath must resolve to defaultFIPSEnabledPath
// (/proc/sys/crypto/fips_enabled) rather than an empty path.
func TestReadOSFIPSEnabled_DefaultPath(t *testing.T) {
	_, err := readOSFIPSEnabled("")
	if err == nil {
		// Only true on a real FIPS-capable Linux host; still exercises the
		// default-path resolution without failing the test on such a host.
		return
	}
	require.Contains(t, err.Error(), defaultFIPSEnabledPath)
}

// TestDetectCryptoProvider covers AC8(2): crypto provider detection must
// return one of the two documented values. This test binary is not built
// with the "boringcrypto" tag, so crypto_provider_default.go is in effect
// and "go-stdlib" is the only correct answer here.
func TestDetectCryptoProvider(t *testing.T) {
	provider := detectCryptoProvider()
	require.Contains(t, []string{"boringcrypto", "go-stdlib"}, provider)
	require.Equal(t, "go-stdlib", provider, "this test binary is not built with GOEXPERIMENT=boringcrypto")
}

// TestExtractTLSEvidence covers AC8(3): a configured tls.Config's
// MinVersion, MaxVersion, and CipherSuites must be extracted verbatim, and
// each cipher suite ID must be resolved to its human-readable name.
func TestExtractTLSEvidence(t *testing.T) {
	cfg := &tls.Config{
		MinVersion:   tls.VersionTLS12,
		MaxVersion:   tls.VersionTLS13,
		CipherSuites: []uint16{tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384, tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256},
	}

	evidence := extractTLSEvidence(cfg)

	require.Equal(t, uint16(tls.VersionTLS12), evidence.MinVersion)
	require.Equal(t, uint16(tls.VersionTLS13), evidence.MaxVersion)
	require.Equal(t, cfg.CipherSuites, evidence.CipherSuites)
	require.Equal(t, []string{
		tls.CipherSuiteName(tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384),
		tls.CipherSuiteName(tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256),
	}, evidence.CipherSuiteNames)
	require.Empty(t, evidence.Note)
}

// TestExtractTLSEvidence_NilConfig covers the edge_case that a nil
// tls.Config (TLS not configured) must produce a zero-value TLSEvidence
// with an explanatory Note, never a panic.
func TestExtractTLSEvidence_NilConfig(t *testing.T) {
	evidence := extractTLSEvidence(nil)

	require.Zero(t, evidence.MinVersion)
	require.Zero(t, evidence.MaxVersion)
	require.Empty(t, evidence.CipherSuites)
	require.Empty(t, evidence.CipherSuiteNames)
	require.NotEmpty(t, evidence.Note)
}

// TestCollectEvidence_JSONSerialization covers AC8(5): the full
// FIPSEvidence struct must serialize to JSON with a valid RFC 3339
// timestamp and every field present. This test environment has no
// /proc/sys/crypto/fips_enabled (it runs on the developer/CI host, not a
// FIPS-enabled Linux target), so CollectEvidence is expected to return a
// non-nil error alongside partial evidence -- both are asserted, per
// error_handling's "aggregates errors ... allowing partial evidence
// collection rather than total failure".
func TestCollectEvidence_JSONSerialization(t *testing.T) {
	cfg := &tls.Config{
		MinVersion:   tls.VersionTLS12,
		CipherSuites: []uint16{tls.TLS_AES_128_GCM_SHA256},
	}

	evidence, err := CollectEvidence(context.Background(), cfg)
	require.NotNil(t, evidence, "partial evidence must still be returned even when OS FIPS status can't be read")

	out, marshalErr := json.Marshal(evidence)
	require.NoError(t, marshalErr)

	var decoded map[string]interface{}
	require.NoError(t, json.Unmarshal(out, &decoded))

	for _, field := range []string{"os_fips_enabled", "crypto_provider", "tls_config", "build_tag_fips", "timestamp", "vault_version"} {
		require.Contains(t, decoded, field, "field %q must be present in serialized evidence", field)
	}

	timestamp, ok := decoded["timestamp"].(string)
	require.True(t, ok)
	require.Regexp(t, rfc3339Regex, timestamp)

	require.Equal(t, "go-stdlib", decoded["crypto_provider"])
	require.Equal(t, evidence.BuildTagFIPS, decoded["build_tag_fips"])
	require.NotEmpty(t, decoded["vault_version"])

	if err != nil {
		require.Equal(t, -1, evidence.OSFIPSEnabled)
		require.NotEmpty(t, evidence.Errors)
		require.Contains(t, evidence.Errors[0], "unable to read FIPS status")
	} else {
		require.Contains(t, []int{0, 1}, evidence.OSFIPSEnabled)
	}
}

// TestCollectEvidence_ContextCanceled confirms a caller that has already
// canceled its context never receives evidence back as if collection had
// succeeded.
func TestCollectEvidence_ContextCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	evidence, err := CollectEvidence(ctx, nil)
	require.Nil(t, evidence)
	require.ErrorIs(t, err, context.Canceled)
}

// TestSampleEvidenceFixture covers AC10: testdata/sample_evidence.json must
// deserialize into FIPSEvidence, and its cipher_suite_names must exactly
// match tls.CipherSuiteName() for each corresponding cipher_suites ID --
// this keeps the fixture from silently drifting out of sync with the
// struct it documents.
func TestSampleEvidenceFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "sample_evidence.json"))
	require.NoError(t, err)

	var evidence FIPSEvidence
	require.NoError(t, json.Unmarshal(raw, &evidence))

	require.Equal(t, 1, evidence.OSFIPSEnabled)
	require.Equal(t, "boringcrypto", evidence.CryptoProvider)
	require.True(t, evidence.BuildTagFIPS)
	require.Regexp(t, rfc3339Regex, evidence.Timestamp)
	require.NotEmpty(t, evidence.VaultVersion)

	require.Len(t, evidence.TLSConfig.CipherSuiteNames, len(evidence.TLSConfig.CipherSuites))
	for i, id := range evidence.TLSConfig.CipherSuites {
		require.Equal(t, tls.CipherSuiteName(id), evidence.TLSConfig.CipherSuiteNames[i])
	}
}
