// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: BUSL-1.1

package http

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestGenerateInventoryReport_KnownRegistrations verifies the JSON output
// for a HandlerRegistry with 5 known registrations: every registration is
// present, the endpoints are sorted by path regardless of registration
// order, auth_required/fips_sensitive match what was registered, and
// generated_at is a valid RFC3339 timestamp.
func TestGenerateInventoryReport_KnownRegistrations(t *testing.T) {
	registry := NewHandlerRegistry()
	registrations := []HandlerRegistration{
		{Path: "/v1/sys/unseal", Methods: []string{http.MethodPut}, AuthRequired: false, FIPSSensitive: true, Handler: noopHandler()},
		{Path: "/v1/sys/health", Methods: []string{http.MethodGet}, AuthRequired: false, FIPSSensitive: false, Handler: noopHandler()},
		{Path: "/v1/sys/seal", Methods: []string{http.MethodPut, http.MethodPost}, AuthRequired: true, FIPSSensitive: true, Handler: noopHandler()},
		{Path: "/v1/sys/audit", Methods: []string{http.MethodGet, http.MethodPut}, AuthRequired: true, FIPSSensitive: false, Handler: noopHandler()},
		{Path: "/v1/sys/leader", Methods: []string{http.MethodGet}, AuthRequired: false, FIPSSensitive: false, Handler: noopHandler()},
	}
	// Register out of alphabetical order so the report's sort is what
	// produces the ordering, not registration order.
	for _, reg := range registrations {
		require.NoError(t, registry.Register(reg))
	}

	before := time.Now().UTC()
	out, err := GenerateInventoryReport(registry)
	require.NoError(t, err)
	after := time.Now().UTC()

	// Valid JSON parseable by standard tools (encoding/json here stands in
	// for jq/Python's json module, which the acceptance criteria also
	// require but which aren't Go-testable directly).
	var report InventoryReport
	require.NoError(t, json.Unmarshal(out, &report))

	generatedAt, err := time.Parse(time.RFC3339, report.GeneratedAt)
	require.NoError(t, err, "generated_at must be a valid RFC3339 timestamp")
	require.WithinRange(t, generatedAt, before.Add(-time.Second), after.Add(time.Second))

	require.Len(t, report.Endpoints, len(registrations))

	wantOrder := []string{
		"/v1/sys/audit",
		"/v1/sys/health",
		"/v1/sys/leader",
		"/v1/sys/seal",
		"/v1/sys/unseal",
	}
	gotOrder := make([]string, len(report.Endpoints))
	for i, e := range report.Endpoints {
		gotOrder[i] = e.Path
	}
	require.Equal(t, wantOrder, gotOrder, "endpoints must be sorted by path for deterministic diffs")

	byPath := make(map[string]EndpointEntry, len(report.Endpoints))
	for _, e := range report.Endpoints {
		byPath[e.Path] = e
	}

	seal := byPath["/v1/sys/seal"]
	require.Equal(t, []string{http.MethodPut, http.MethodPost}, seal.Methods)
	require.True(t, seal.AuthRequired)
	require.True(t, seal.FIPSSensitive)

	unseal := byPath["/v1/sys/unseal"]
	require.False(t, unseal.AuthRequired)
	require.True(t, unseal.FIPSSensitive)

	health := byPath["/v1/sys/health"]
	require.False(t, health.AuthRequired)
	require.False(t, health.FIPSSensitive)

	audit := byPath["/v1/sys/audit"]
	require.True(t, audit.AuthRequired)
	require.False(t, audit.FIPSSensitive)

	leader := byPath["/v1/sys/leader"]
	require.False(t, leader.AuthRequired)
	require.False(t, leader.FIPSSensitive)
}

// TestGenerateInventoryReport_EmptyRegistry covers the empty-registry edge
// case: the report must be valid JSON with an empty endpoints array, not an
// error and not a null endpoints field.
func TestGenerateInventoryReport_EmptyRegistry(t *testing.T) {
	registry := NewHandlerRegistry()

	out, err := GenerateInventoryReport(registry)
	require.NoError(t, err)

	var report InventoryReport
	require.NoError(t, json.Unmarshal(out, &report))
	require.NotNil(t, report.Endpoints, "endpoints must serialize as [] rather than null")
	require.Empty(t, report.Endpoints)

	require.Contains(t, string(out), `"endpoints": []`)
}

// TestGenerateInventoryReport_NilRegistry verifies the defensive nil check:
// calling the generator without a registry is a caller error, not a panic.
func TestGenerateInventoryReport_NilRegistry(t *testing.T) {
	_, err := GenerateInventoryReport(nil)
	require.Error(t, err)
}

// TestGenerateInventoryReport_DefaultRegistry verifies acceptance criterion
// 4: running the generator against the fully-populated HandlerRegistry that
// BuildDefaultRegistry mirrors from handlerWithSettings' default case
// produces a report covering every endpoint previously registered via
// direct mux.Handle calls, including a representative sample spanning the
// injectDataIntoTopRoutes batch, the seal lifecycle, the catch-all
// handlers, and the UI routes.
func TestGenerateInventoryReport_DefaultRegistry(t *testing.T) {
	registry, err := BuildDefaultRegistry(InventorySettings{})
	require.NoError(t, err)

	out, err := GenerateInventoryReport(registry)
	require.NoError(t, err)

	var report InventoryReport
	require.NoError(t, json.Unmarshal(out, &report))
	require.GreaterOrEqual(t, len(report.Endpoints), 40, "the full default-settings registry should cover 40+ endpoints")

	for i := 1; i < len(report.Endpoints); i++ {
		require.Less(t, report.Endpoints[i-1].Path, report.Endpoints[i].Path, "endpoints must be strictly sorted by path")
	}

	byPath := make(map[string]EndpointEntry, len(report.Endpoints))
	for _, e := range report.Endpoints {
		byPath[e.Path] = e
	}

	type wantMeta struct {
		authRequired  bool
		fipsSensitive bool
	}
	for path, want := range map[string]wantMeta{
		"/v1/sys/rotate":                 {authRequired: true, fipsSensitive: true},
		"/v1/sys/audit":                  {authRequired: true, fipsSensitive: false},
		"/v1/sys/wrapping/wrap":          {authRequired: true, fipsSensitive: true},
		"/v1/sys/seal":                   {authRequired: true, fipsSensitive: true},
		"/v1/sys/unseal":                 {authRequired: false, fipsSensitive: true},
		"/v1/sys/":                       {authRequired: true, fipsSensitive: false},
		"/v1/":                           {authRequired: true, fipsSensitive: false},
		"/v1/sys/storage/raft/bootstrap": {authRequired: true, fipsSensitive: false},
		"/ui/":                           {authRequired: false, fipsSensitive: false},
		"/robots.txt":                    {authRequired: false, fipsSensitive: false},
		"/v1/sys/health":                 {authRequired: false, fipsSensitive: false},
		"/v1/sys/leader":                 {authRequired: false, fipsSensitive: false},
	} {
		got, ok := byPath[path]
		require.True(t, ok, "expected an inventory entry for %q", path)
		require.Equal(t, want.authRequired, got.AuthRequired, "auth_required mismatch for %q", path)
		require.Equal(t, want.fipsSensitive, got.FIPSSensitive, "fips_sensitive mismatch for %q", path)
		require.NotEmpty(t, got.Methods, "%q must declare explicit methods", path)
	}

	// Conditional endpoints must be absent entirely when their setting is
	// off.
	for _, path := range []string{
		"/v1/sys/rekey/init", "/v1/sys/generate-root/attempt",
	} {
		_, ok := byPath[path]
		require.False(t, ok, "%q must not be registered when its enabling setting is false", path)
	}
}

// TestGenerateInventoryReport_DefaultRegistry_ConditionalSettings verifies
// that BuildDefaultRegistry adds the unauthRekey/unauthGenerateRoot
// endpoints, unauthenticated, only when the corresponding InventorySettings
// field is set, and that the report documents that combination via the
// endpoints it contains.
func TestGenerateInventoryReport_DefaultRegistry_ConditionalSettings(t *testing.T) {
	baseline, err := BuildDefaultRegistry(InventorySettings{})
	require.NoError(t, err)
	baselineCount := len(baseline.Inventory())

	withRekey, err := BuildDefaultRegistry(InventorySettings{UnauthRekey: true})
	require.NoError(t, err)
	require.Len(t, withRekey.Inventory(), baselineCount+6)

	withGenerateRoot, err := BuildDefaultRegistry(InventorySettings{UnauthGenerateRoot: true})
	require.NoError(t, err)
	require.Len(t, withGenerateRoot.Inventory(), baselineCount+2)

	out, err := GenerateInventoryReport(withRekey)
	require.NoError(t, err)
	var report InventoryReport
	require.NoError(t, json.Unmarshal(out, &report))

	found := false
	for _, e := range report.Endpoints {
		if e.Path == "/v1/sys/rekey/init" {
			found = true
			require.False(t, e.AuthRequired)
			require.True(t, e.FIPSSensitive)
		}
	}
	require.True(t, found, "/v1/sys/rekey/init must appear in the report when UnauthRekey is set")
}
