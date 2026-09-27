// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: BUSL-1.1

package http

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/hashicorp/vault/internalshared/configutil"
	"github.com/hashicorp/vault/vault"
	"github.com/stretchr/testify/require"
)

// testHandlerRegistryProps returns a real, unsealed *vault.Core together
// with the minimal *vault.HandlerProperties needed to exercise
// HandlerRegistry.Build's wrapping chain.
func testHandlerRegistryProps(t *testing.T) (*vault.Core, *vault.HandlerProperties) {
	t.Helper()
	core, _, _ := vault.TestCoreUnsealed(t)
	props := &vault.HandlerProperties{
		Core:           core,
		ListenerConfig: &configutil.Listener{},
	}
	return core, props
}

func noopHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
}

// TestHandlerRegistry_Register covers successful registration plus every
// validation rule Register enforces: /v1/ prefix, non-empty Methods, and a
// non-nil Handler.
func TestHandlerRegistry_Register(t *testing.T) {
	testCases := []struct {
		name    string
		reg     HandlerRegistration
		wantErr string
	}{
		{
			name: "valid registration",
			reg: HandlerRegistration{
				Path:         "/v1/sys/test-registry-valid",
				Methods:      []string{http.MethodGet},
				AuthRequired: true,
				Handler:      noopHandler(),
			},
		},
		{
			name: "valid registration with multiple methods",
			reg: HandlerRegistration{
				Path:         "/v1/sys/test-registry-multi-method",
				Methods:      []string{http.MethodGet, http.MethodPost, "LIST"},
				AuthRequired: true,
				Handler:      noopHandler(),
			},
		},
		{
			name: "missing /v1/ prefix",
			reg: HandlerRegistration{
				Path:    "sys/test-registry-invalid",
				Methods: []string{http.MethodGet},
				Handler: noopHandler(),
			},
			wantErr: "must start with /v1/",
		},
		{
			name: "empty path",
			reg: HandlerRegistration{
				Path:    "",
				Methods: []string{http.MethodGet},
				Handler: noopHandler(),
			},
			wantErr: "must start with /v1/",
		},
		{
			name: "empty methods",
			reg: HandlerRegistration{
				Path:    "/v1/sys/test-registry-empty-methods",
				Methods: nil,
				Handler: noopHandler(),
			},
			wantErr: "at least one explicit HTTP method",
		},
		{
			name: "nil handler",
			reg: HandlerRegistration{
				Path:    "/v1/sys/test-registry-nil-handler",
				Methods: []string{http.MethodGet},
				Handler: nil,
			},
			wantErr: "non-nil Handler",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			hr := NewHandlerRegistry()
			err := hr.Register(tc.reg)
			if tc.wantErr == "" {
				require.NoError(t, err)
				require.Len(t, hr.Inventory(), 1)
			} else {
				require.Error(t, err)
				require.Contains(t, err.Error(), tc.wantErr)
				require.Empty(t, hr.Inventory())
			}
		})
	}
}

// TestHandlerRegistry_Register_DuplicatePathMethod verifies that Register
// rejects a path+method combination that has already been claimed, while
// still allowing a different method on the same path, and that a rejected
// duplicate does not partially mutate the registry.
func TestHandlerRegistry_Register_DuplicatePathMethod(t *testing.T) {
	hr := NewHandlerRegistry()

	require.NoError(t, hr.Register(HandlerRegistration{
		Path:    "/v1/sys/test-registry-dup",
		Methods: []string{http.MethodGet, http.MethodPost},
		Handler: noopHandler(),
	}))

	// Re-registering an already-claimed method on the same path must fail
	// with a descriptive error identifying both the path and the method.
	err := hr.Register(HandlerRegistration{
		Path:    "/v1/sys/test-registry-dup",
		Methods: []string{http.MethodPost},
		Handler: noopHandler(),
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "duplicate registration")
	require.Contains(t, err.Error(), "/v1/sys/test-registry-dup")
	require.Contains(t, err.Error(), http.MethodPost)
	require.Len(t, hr.Inventory(), 1, "rejected duplicate must not be recorded")

	// A batch registration where only one of several methods collides must
	// be rejected entirely, not partially applied.
	err = hr.Register(HandlerRegistration{
		Path:    "/v1/sys/test-registry-dup",
		Methods: []string{http.MethodDelete, http.MethodGet},
		Handler: noopHandler(),
	})
	require.Error(t, err)
	require.Len(t, hr.Inventory(), 1, "partially colliding batch must not be partially recorded")

	// A disjoint method on the same path is legitimate and must succeed.
	require.NoError(t, hr.Register(HandlerRegistration{
		Path:    "/v1/sys/test-registry-dup",
		Methods: []string{http.MethodDelete},
		Handler: noopHandler(),
	}))
	require.Len(t, hr.Inventory(), 2)
}

// TestHandlerRegistry_Build_RoutesToRegisteredHandler verifies that Build
// produces a functional handler: a request for a registered path+method is
// routed to the registered Handler.
func TestHandlerRegistry_Build_RoutesToRegisteredHandler(t *testing.T) {
	_, props := testHandlerRegistryProps(t)

	hr := NewHandlerRegistry()
	var invoked bool
	require.NoError(t, hr.Register(HandlerRegistration{
		Path:         "/v1/sys/test-registry-route",
		Methods:      []string{http.MethodGet},
		AuthRequired: true,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			invoked = true
			w.WriteHeader(http.StatusTeapot)
		}),
	}))

	built := hr.Build(props)
	require.NotNil(t, built)

	srv := httptest.NewServer(built)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/v1/sys/test-registry-route")
	require.NoError(t, err)
	defer resp.Body.Close()

	require.True(t, invoked, "registered handler was not invoked")
	require.Equal(t, http.StatusTeapot, resp.StatusCode)
}

// TestHandlerRegistry_Build_UnregisteredMethodNotRouted verifies that Build
// only routes the methods explicitly declared for a path, matching the
// declarative, path+method granularity Register enforces.
func TestHandlerRegistry_Build_UnregisteredMethodNotRouted(t *testing.T) {
	_, props := testHandlerRegistryProps(t)

	hr := NewHandlerRegistry()
	require.NoError(t, hr.Register(HandlerRegistration{
		Path:    "/v1/sys/test-registry-method-scope",
		Methods: []string{http.MethodGet},
		Handler: noopHandler(),
	}))

	built := hr.Build(props)
	srv := httptest.NewServer(built)
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/v1/sys/test-registry-method-scope", "application/json", nil)
	require.NoError(t, err)
	defer resp.Body.Close()

	require.NotEqual(t, http.StatusTeapot, resp.StatusCode)
	require.NotEqual(t, http.StatusOK, resp.StatusCode)
}

// TestHandlerRegistry_Build_EmptyRegistryReturns404 covers the edge case of
// calling Build before any Register call: the result must be a valid
// handler that 404s for every path, not a nil or panicking handler.
func TestHandlerRegistry_Build_EmptyRegistryReturns404(t *testing.T) {
	_, props := testHandlerRegistryProps(t)

	hr := NewHandlerRegistry()
	built := hr.Build(props)
	require.NotNil(t, built)

	srv := httptest.NewServer(built)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/v1/sys/does-not-exist")
	require.NoError(t, err)
	defer resp.Body.Close()

	require.Equal(t, http.StatusNotFound, resp.StatusCode)
}

// TestHandlerRegistry_Build_AppliesWrappingChain verifies that Build wraps
// the mux in the same middleware chain handlerWithSettings uses, by
// checking for a response header that only the CORS wrapper sets.
func TestHandlerRegistry_Build_AppliesWrappingChain(t *testing.T) {
	core, props := testHandlerRegistryProps(t)

	hr := NewHandlerRegistry()
	require.NoError(t, hr.Register(HandlerRegistration{
		Path:    "/v1/sys/test-registry-cors",
		Methods: []string{http.MethodGet},
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		}),
	}))

	built := hr.Build(props)
	srv := httptest.NewServer(built)
	defer srv.Close()

	corsConfig := core.CORSConfig()
	require.NoError(t, corsConfig.Enable(context.Background(), []string{srv.URL}, nil))

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/v1/sys/test-registry-cors", nil)
	require.NoError(t, err)
	req.Header.Set("Origin", srv.URL)

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	require.Equal(t, srv.URL, resp.Header.Get("Access-Control-Allow-Origin"),
		"Access-Control-Allow-Origin header should be set by wrapCORSHandler")
}

// TestHandlerRegistry_Inventory registers more than ten handlers, including
// one that is intentionally unauthenticated (mirroring sys/unseal, which
// must be reachable while the vault is sealed), and verifies Inventory
// returns every registration with its authorization metadata intact.
func TestHandlerRegistry_Inventory(t *testing.T) {
	registrations := []HandlerRegistration{
		{Path: "/v1/sys/unseal", Methods: []string{http.MethodPut}, AuthRequired: false, AuditRequired: true, FIPSSensitive: true, Handler: noopHandler()},
		{Path: "/v1/sys/seal", Methods: []string{http.MethodPut}, AuthRequired: true, AuditRequired: true, FIPSSensitive: true, Handler: noopHandler()},
		{Path: "/v1/sys/seal-status", Methods: []string{http.MethodGet}, AuthRequired: false, AuditRequired: false, FIPSSensitive: false, Handler: noopHandler()},
		{Path: "/v1/sys/test-inv-3", Methods: []string{http.MethodGet}, AuthRequired: true, AuditRequired: false, FIPSSensitive: false, Handler: noopHandler()},
		{Path: "/v1/sys/test-inv-4", Methods: []string{http.MethodPost, http.MethodPut}, AuthRequired: true, AuditRequired: true, FIPSSensitive: false, Handler: noopHandler()},
		{Path: "/v1/sys/test-inv-5", Methods: []string{http.MethodGet}, AuthRequired: true, AuditRequired: false, FIPSSensitive: false, Handler: noopHandler()},
		{Path: "/v1/sys/test-inv-6", Methods: []string{http.MethodGet}, AuthRequired: true, AuditRequired: false, FIPSSensitive: false, Handler: noopHandler()},
		{Path: "/v1/sys/test-inv-7", Methods: []string{http.MethodDelete}, AuthRequired: true, AuditRequired: false, FIPSSensitive: false, Handler: noopHandler()},
		{Path: "/v1/sys/test-inv-8", Methods: []string{http.MethodGet}, AuthRequired: true, AuditRequired: false, FIPSSensitive: false, Handler: noopHandler()},
		{Path: "/v1/sys/test-inv-9", Methods: []string{"LIST"}, AuthRequired: true, AuditRequired: false, FIPSSensitive: false, Handler: noopHandler()},
		{Path: "/v1/sys/test-inv-10", Methods: []string{http.MethodGet}, AuthRequired: true, AuditRequired: false, FIPSSensitive: true, Handler: noopHandler()},
	}
	require.GreaterOrEqual(t, len(registrations), 10, "test fixture must cover 10+ registrations")

	hr := NewHandlerRegistry()
	for _, reg := range registrations {
		require.NoError(t, hr.Register(reg))
	}

	got := hr.Inventory()
	require.Len(t, got, len(registrations))

	for i, want := range registrations {
		require.Equal(t, want.Path, got[i].Path, "path mismatch at index %d", i)
		require.Equal(t, want.Methods, got[i].Methods, "methods mismatch at index %d", i)
		require.Equal(t, want.AuthRequired, got[i].AuthRequired, "AuthRequired mismatch at index %d", i)
		require.Equal(t, want.AuditRequired, got[i].AuditRequired, "AuditRequired mismatch at index %d", i)
		require.Equal(t, want.FIPSSensitive, got[i].FIPSSensitive, "FIPSSensitive mismatch at index %d", i)
		require.NotNil(t, got[i].Handler, "handler must not be nil at index %d", i)
	}

	// sys/unseal is unauthenticated by design because the vault is sealed;
	// Inventory must surface that as explicit AuthRequired=false metadata,
	// not as an error or omission.
	var foundUnseal bool
	for _, r := range got {
		if r.Path == "/v1/sys/unseal" {
			foundUnseal = true
			require.False(t, r.AuthRequired, "sys/unseal must be reported as intentionally unauthenticated")
		}
	}
	require.True(t, foundUnseal)
}

// TestHandlerRegistry_Inventory_ReturnsCopy verifies that mutating the slice
// or entries returned by Inventory does not affect the registry's internal
// state.
func TestHandlerRegistry_Inventory_ReturnsCopy(t *testing.T) {
	hr := NewHandlerRegistry()
	require.NoError(t, hr.Register(HandlerRegistration{
		Path:    "/v1/sys/test-registry-copy",
		Methods: []string{http.MethodGet},
		Handler: noopHandler(),
	}))

	got := hr.Inventory()
	require.Len(t, got, 1)
	got[0].Path = "/v1/mutated"
	got = append(got, HandlerRegistration{Path: "/v1/sys/injected", Methods: []string{http.MethodGet}, Handler: noopHandler()})

	again := hr.Inventory()
	require.Len(t, again, 1)
	require.Equal(t, "/v1/sys/test-registry-copy", again[0].Path)
}
