// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: BUSL-1.1

package http

import (
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/hashicorp/vault/http/priority"
	"github.com/hashicorp/vault/vault"
)

// HandlerRegistration describes a single HTTP handler registration together
// with the authorization metadata Vault needs to audit its trust boundary.
// Unlike the ad-hoc mux.Handle calls in handlerWithSettings, every field here
// is explicit: authorization intent, audit classification, and FIPS
// sensitivity live at the registration site instead of being buried in the
// handler implementation.
type HandlerRegistration struct {
	// Path is the mux pattern the handler is registered under. Must begin
	// with "/v1/".
	Path string

	// Methods lists the HTTP methods this registration serves. It must be
	// non-empty: there is no implicit "all methods" default, so that every
	// registration states its supported methods explicitly.
	Methods []string

	// AuthRequired records whether Vault enforces token/policy authorization
	// on this path before Handler is invoked. Some endpoints are
	// intentionally unauthenticated by design (e.g. sys/unseal, since the
	// vault is sealed and no token store is available yet); those
	// registrations must set AuthRequired to false explicitly rather than
	// leaving the intent implicit in the handler's own code.
	AuthRequired bool

	// AuditRequired records whether requests and responses for this path
	// must be written to the audit broker.
	AuditRequired bool

	// FIPSSensitive marks handlers that perform, or gate access to,
	// cryptographic operations subject to FIPS 140-3 boundary requirements.
	FIPSSensitive bool

	// Handler serves requests for Path.
	Handler http.Handler
}

// HandlerRegistry is a centralized, declarative registry of HTTP handler
// registrations. It is designed to eventually replace the direct mux.Handle
// calls in handlerWithSettings (http/handler.go) with a typed inventory that
// makes authorization requirements auditable at registration time. This
// story introduces the type only; migrating existing handlers to use it is
// left to subsequent stories.
type HandlerRegistry struct {
	mu sync.RWMutex

	// registrations holds every accepted HandlerRegistration in registration
	// order, so Inventory() can report handlers deterministically.
	registrations []HandlerRegistration

	// pathMethodIndex tracks which methods have already been claimed for a
	// given path, keyed by path then method, so Register can reject
	// duplicate path+method combinations.
	pathMethodIndex map[string]map[string]bool
}

// NewHandlerRegistry returns an empty HandlerRegistry ready to accept
// registrations. A zero-value Build() (i.e. before any Register call)
// returns a valid, empty handler that 404s for every path.
func NewHandlerRegistry() *HandlerRegistry {
	return &HandlerRegistry{
		pathMethodIndex: make(map[string]map[string]bool),
	}
}

// Register validates and records a handler registration. It returns a
// descriptive error if:
//   - Path does not start with "/v1/"
//   - Methods is empty
//   - Handler is nil
//   - any Path+Method combination has already been registered
//
// Register is safe for concurrent use.
func (hr *HandlerRegistry) Register(reg HandlerRegistration) error {
	if !strings.HasPrefix(reg.Path, "/v1/") {
		return fmt.Errorf("handler registry: invalid path %q: path must start with /v1/", reg.Path)
	}
	if len(reg.Methods) == 0 {
		return fmt.Errorf("handler registry: path %q must declare at least one explicit HTTP method", reg.Path)
	}
	if reg.Handler == nil {
		return fmt.Errorf("handler registry: path %q must have a non-nil Handler", reg.Path)
	}

	hr.mu.Lock()
	defer hr.mu.Unlock()

	registeredMethods := hr.pathMethodIndex[reg.Path]

	// Check for duplicates against the whole batch before mutating any
	// state, so a rejected registration never partially claims methods.
	for _, method := range reg.Methods {
		if registeredMethods != nil && registeredMethods[method] {
			return fmt.Errorf("handler registry: duplicate registration for path %q method %q", reg.Path, method)
		}
	}

	if registeredMethods == nil {
		registeredMethods = make(map[string]bool, len(reg.Methods))
		hr.pathMethodIndex[reg.Path] = registeredMethods
	}
	for _, method := range reg.Methods {
		registeredMethods[method] = true
	}

	hr.registrations = append(hr.registrations, reg)
	return nil
}

// RegisterHandlers mounts every registered handler onto mux, once per
// declared method, using Go's method-tagged mux patterns (e.g.
// "GET /v1/sys/example"). This mirrors the path+method granularity that
// Register enforces, so two registrations may legitimately share a Path
// with disjoint Methods without colliding, which a plain path-only
// mux.Handle call would not allow.
//
// RegisterHandlers is the merge point for the incremental migration in
// http/handler.go: handlerWithSettings creates a HandlerRegistry, migrates
// individual endpoints onto it via Register, then calls RegisterHandlers to
// mount those handlers onto the same *http.ServeMux used for the
// not-yet-migrated direct mux.Handle calls. That shared mux is wrapped in
// the middleware chain exactly once, so migrated and unmigrated handlers
// receive identical treatment. Callers that want a fully wrapped, standalone
// handler for the registry's contents should use Build instead.
//
// RegisterHandlers is safe for concurrent use.
func (hr *HandlerRegistry) RegisterHandlers(mux *http.ServeMux) {
	hr.mu.RLock()
	defer hr.mu.RUnlock()

	hr.mountLocked(mux)
}

// mountLocked mounts every registered handler onto mux. Callers must hold
// hr.mu (for reading or writing) before calling this.
func (hr *HandlerRegistry) mountLocked(mux *http.ServeMux) {
	for _, reg := range hr.registrations {
		for _, method := range reg.Methods {
			mux.Handle(method+" "+reg.Path, reg.Handler)
		}
	}
}

// Build constructs an *http.ServeMux from every registered handler and
// returns it wrapped in the same middleware chain that handlerWithSettings
// applies in http/handler.go: wrapHelpHandler, wrapCORSHandler,
// withRoleRateLimitQuotaWrapping, wrapJSONLimitsHandler, rateLimitQuotaWrapping,
// entWrapGenericHandler, wrapMaxRequestSizeHandler, wrapTokenHeaderSizeHandler,
// and priority.WrapRequestPriorityHandler, applied in that exact order.
// Preserving the order matters: entWrapGenericHandler is what establishes
// the root namespace on the request context, which rateLimitQuotaWrapping
// and withRoleRateLimitQuotaWrapping depend on further down the chain.
//
// Each registration is mounted once per declared method using Go's
// method-tagged mux patterns (e.g. "GET /v1/sys/example"), mirroring the
// path+method granularity that Register enforces. This lets two
// registrations legitimately share a Path with disjoint Methods without
// colliding, which a plain path-only mux.Handle call would not allow.
//
// Build never returns nil, even when no handlers have been registered; in
// that case the returned handler 404s for every path, matching the behavior
// of an empty *http.ServeMux.
func (hr *HandlerRegistry) Build(props *vault.HandlerProperties) http.Handler {
	hr.mu.RLock()
	defer hr.mu.RUnlock()

	mux := http.NewServeMux()
	hr.mountLocked(mux)

	core := props.Core

	var wrappedHandler http.Handler = mux
	wrappedHandler = wrapHelpHandler(wrappedHandler, core)
	wrappedHandler = wrapCORSHandler(wrappedHandler, core)
	wrappedHandler = withRoleRateLimitQuotaWrapping(wrappedHandler, core)
	wrappedHandler = wrapJSONLimitsHandler(wrappedHandler, props)
	wrappedHandler = rateLimitQuotaWrapping(wrappedHandler, core)
	wrappedHandler = entWrapGenericHandler(core, wrappedHandler, props)
	wrappedHandler = wrapMaxRequestSizeHandler(wrappedHandler, props)
	wrappedHandler = wrapTokenHeaderSizeHandler(wrappedHandler, props)
	wrappedHandler = priority.WrapRequestPriorityHandler(wrappedHandler)

	return wrappedHandler
}

// Inventory returns a copy of every registered HandlerRegistration, in
// registration order, suitable for producing an auditable report of every
// path Vault serves and whether it requires authentication, requires
// auditing, or is FIPS-sensitive. Mutating the returned slice or its
// elements does not affect the registry.
func (hr *HandlerRegistry) Inventory() []HandlerRegistration {
	hr.mu.RLock()
	defer hr.mu.RUnlock()

	out := make([]HandlerRegistration, len(hr.registrations))
	copy(out, hr.registrations)
	return out
}
