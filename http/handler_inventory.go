// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: BUSL-1.1

package http

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"time"
)

// EndpointEntry is the auditable, serializable view of a single
// HandlerRegistration: the authorization metadata an auditor needs to
// understand a path's trust boundary, without the in-memory Handler value,
// which cannot be (and does not need to be) serialized to JSON.
type EndpointEntry struct {
	Path          string   `json:"path"`
	Methods       []string `json:"methods"`
	AuthRequired  bool     `json:"auth_required"`
	FIPSSensitive bool     `json:"fips_sensitive"`
}

// InventoryReport is the top-level document GenerateInventoryReport
// produces: every endpoint HandlerRegistry.Inventory() reports, sorted by
// Path for deterministic, diffable output, plus the timestamp the report
// was generated.
type InventoryReport struct {
	GeneratedAt string          `json:"generated_at"`
	Endpoints   []EndpointEntry `json:"endpoints"`
}

// GenerateInventoryReport reads every registration on registry via
// Inventory(), converts each to an EndpointEntry, sorts the result by Path
// so re-running the generator against an unchanged registry produces
// byte-identical output suitable for a git diff between releases, and
// marshals the result as an indented InventoryReport. registry must not be
// nil.
//
// GenerateInventoryReport never mutates registry: Inventory() already
// returns a defensive copy, and the EndpointEntry conversion below copies
// each registration's Methods slice again so the report cannot alias, and
// therefore cannot be corrupted by, the registry's internal state.
func GenerateInventoryReport(registry *HandlerRegistry) ([]byte, error) {
	if registry == nil {
		return nil, fmt.Errorf("handler inventory: registry must not be nil")
	}

	inventory := registry.Inventory()
	endpoints := make([]EndpointEntry, 0, len(inventory))
	for _, reg := range inventory {
		methods := make([]string, len(reg.Methods))
		copy(methods, reg.Methods)
		endpoints = append(endpoints, EndpointEntry{
			Path:          reg.Path,
			Methods:       methods,
			AuthRequired:  reg.AuthRequired,
			FIPSSensitive: reg.FIPSSensitive,
		})
	}

	sort.Slice(endpoints, func(i, j int) bool {
		return endpoints[i].Path < endpoints[j].Path
	})

	report := InventoryReport{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Endpoints:   endpoints,
	}

	out, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("handler inventory: failed to marshal report: %w", err)
	}
	return out, nil
}

// InventorySettings mirrors the handlerSettings gates in http/handler.go
// (unauthRekey, unauthGenerateRoot, unauthDROperationToken) with exported
// fields, so tooling outside this package (see tools/handler-inventory) can
// request a specific combination of conditional registrations without a
// live *vault.Core to read core.GetEnableUnauthRekey() and friends from.
type InventorySettings struct {
	UnauthRekey            bool
	UnauthGenerateRoot     bool
	UnauthDROperationToken bool
}

// inventoryHandler is used only when building a HandlerRegistry for
// inventory-report purposes: GenerateInventoryReport only reads
// Path/Methods/AuthRequired/FIPSSensitive off each HandlerRegistration, so
// no live *vault.Core-backed handler is required to populate the registry
// BuildDefaultRegistry returns. It always responds 404, so it is not,
// and must never be, wired into a real request path.
var inventoryHandler http.Handler = http.NotFoundHandler()

// BuildDefaultRegistry constructs a HandlerRegistry populated with the same
// Path/Methods/AuthRequired/FIPSSensitive metadata that handlerWithSettings'
// default case (see http/handler.go) registers, for the given settings and
// with the same defaults handlerWithSettings assumes when its
// *vault.HandlerProperties.ListenerConfig is unset: UI enabled and built
// in, and sys/metrics, sys/pprof/, and sys/in-flight-req authenticated
// rather than exposed anonymously. It uses inventoryHandler in place of the
// real, *vault.Core-backed handler constructors, so it runs entirely from
// code: no running Vault server or live *vault.Core is required, matching
// this package's report-generation requirement.
//
// BuildDefaultRegistry is a metadata mirror of handlerWithSettings, not a
// code path handlerWithSettings itself calls, so the two must be kept in
// sync by hand. http/handler_test.go's TestHandlerRegistry_AllEndpoints and
// TestHandlerRegistry_AllEndpoints_ConditionalSettings pin
// handlerWithSettings' actual registration set against an equivalent
// fixture; run those alongside TestGenerateInventoryReport after changing
// either side of this mirror.
func BuildDefaultRegistry(settings InventorySettings) (*HandlerRegistry, error) {
	registry := NewHandlerRegistry()

	register := func(regs ...HandlerRegistration) error {
		for _, reg := range regs {
			if err := registry.Register(reg); err != nil {
				return fmt.Errorf("handler inventory: failed to register %q: %w", reg.Path, err)
			}
		}
		return nil
	}

	if err := register(
		HandlerRegistration{
			Path:          "/v1/sys/init",
			Methods:       []string{"GET", "PUT", "POST"},
			AuthRequired:  false,
			FIPSSensitive: false,
			Handler:       inventoryHandler,
		},
		HandlerRegistration{
			Path:          "/v1/sys/config/state/",
			Methods:       fullLogicalMethods,
			AuthRequired:  true,
			FIPSSensitive: false,
			Handler:       inventoryHandler,
		},
		HandlerRegistration{
			Path:          "/v1/sys/host-info",
			Methods:       fullLogicalMethods,
			AuthRequired:  true,
			FIPSSensitive: false,
			Handler:       inventoryHandler,
		},
		HandlerRegistration{
			Path:          "/v1/sys/seal-status",
			Methods:       []string{http.MethodGet},
			AuthRequired:  false,
			FIPSSensitive: false,
			Handler:       inventoryHandler,
		},
		HandlerRegistration{
			Path:          "/v1/sys/seal-backend-status",
			Methods:       []string{http.MethodGet},
			AuthRequired:  false,
			FIPSSensitive: false,
			Handler:       inventoryHandler,
		},
		HandlerRegistration{
			Path:          "/v1/sys/seal",
			Methods:       []string{http.MethodPut, http.MethodPost},
			AuthRequired:  true,
			FIPSSensitive: true,
			Handler:       inventoryHandler,
		},
		HandlerRegistration{
			Path:          "/v1/sys/step-down",
			Methods:       []string{http.MethodPut, http.MethodPost},
			AuthRequired:  true,
			FIPSSensitive: false,
			Handler:       inventoryHandler,
		},
		HandlerRegistration{
			// AuthRequired is false by design: the vault is sealed when this
			// endpoint is called, so there is no unsealed token store to
			// validate a token against. See the matching registration in
			// handlerWithSettings.
			Path:          "/v1/sys/unseal",
			Methods:       []string{http.MethodPut, http.MethodPost},
			AuthRequired:  false,
			FIPSSensitive: true,
			Handler:       inventoryHandler,
		},
		HandlerRegistration{
			Path:          "/v1/sys/leader",
			Methods:       []string{http.MethodGet},
			AuthRequired:  false,
			FIPSSensitive: false,
			Handler:       inventoryHandler,
		},
		HandlerRegistration{
			Path:          "/v1/sys/health",
			Methods:       []string{http.MethodGet, http.MethodHead},
			AuthRequired:  false,
			FIPSSensitive: false,
			Handler:       inventoryHandler,
		},
		HandlerRegistration{
			Path:          "/v1/sys/monitor",
			Methods:       fullLogicalMethods,
			AuthRequired:  true,
			FIPSSensitive: false,
			Handler:       inventoryHandler,
		},
	); err != nil {
		return nil, err
	}

	if settings.UnauthGenerateRoot {
		if err := register(
			HandlerRegistration{
				Path:          "/v1/sys/generate-root/attempt",
				Methods:       []string{http.MethodGet, http.MethodPut, http.MethodPost, http.MethodDelete},
				AuthRequired:  false,
				FIPSSensitive: true,
				Handler:       inventoryHandler,
			},
			HandlerRegistration{
				Path:          "/v1/sys/generate-root/update",
				Methods:       []string{http.MethodPut, http.MethodPost},
				AuthRequired:  false,
				FIPSSensitive: true,
				Handler:       inventoryHandler,
			},
		); err != nil {
			return nil, err
		}
	}

	if settings.UnauthRekey {
		if err := register(
			HandlerRegistration{
				Path:          "/v1/sys/rekey/init",
				Methods:       []string{http.MethodGet, http.MethodPut, http.MethodPost, http.MethodDelete},
				AuthRequired:  false,
				FIPSSensitive: true,
				Handler:       inventoryHandler,
			},
			HandlerRegistration{
				Path:          "/v1/sys/rekey/update",
				Methods:       []string{http.MethodPut, http.MethodPost},
				AuthRequired:  false,
				FIPSSensitive: true,
				Handler:       inventoryHandler,
			},
			HandlerRegistration{
				Path:          "/v1/sys/rekey/verify",
				Methods:       []string{http.MethodGet, http.MethodPut, http.MethodPost, http.MethodDelete},
				AuthRequired:  false,
				FIPSSensitive: true,
				Handler:       inventoryHandler,
			},
			HandlerRegistration{
				Path:          "/v1/sys/rekey-recovery-key/init",
				Methods:       []string{http.MethodGet, http.MethodPut, http.MethodPost, http.MethodDelete},
				AuthRequired:  false,
				FIPSSensitive: true,
				Handler:       inventoryHandler,
			},
			HandlerRegistration{
				Path:          "/v1/sys/rekey-recovery-key/update",
				Methods:       []string{http.MethodPut, http.MethodPost},
				AuthRequired:  false,
				FIPSSensitive: true,
				Handler:       inventoryHandler,
			},
			HandlerRegistration{
				Path:          "/v1/sys/rekey-recovery-key/verify",
				Methods:       []string{http.MethodGet, http.MethodPut, http.MethodPost, http.MethodDelete},
				AuthRequired:  false,
				FIPSSensitive: true,
				Handler:       inventoryHandler,
			},
		); err != nil {
			return nil, err
		}
	}

	if err := register(
		HandlerRegistration{
			Path:          "/v1/sys/storage/raft/bootstrap",
			Methods:       []string{http.MethodPut, http.MethodPost},
			AuthRequired:  true,
			FIPSSensitive: false,
			Handler:       inventoryHandler,
		},
		HandlerRegistration{
			Path:          "/v1/sys/storage/raft/join",
			Methods:       []string{http.MethodPut, http.MethodPost},
			AuthRequired:  true,
			FIPSSensitive: false,
			Handler:       inventoryHandler,
		},
		HandlerRegistration{
			Path:          "/v1/sys/internal/ui/feature-flags",
			Methods:       []string{http.MethodGet},
			AuthRequired:  false,
			FIPSSensitive: false,
			Handler:       inventoryHandler,
		},
	); err != nil {
		return nil, err
	}

	// injectDataIntoTopRoutes (http/handler.go) is the single source of
	// truth for this batch: reusing it here, instead of hand-copying its
	// contents, means adding or removing one of these /v1/sys/* paths in
	// handlerWithSettings automatically flows through to the inventory
	// report without a second edit.
	for _, route := range injectDataIntoTopRoutes {
		if err := register(HandlerRegistration{
			Path:          route.path,
			Methods:       []string{http.MethodGet, http.MethodPut, http.MethodPost, http.MethodDelete, "LIST"},
			AuthRequired:  true,
			FIPSSensitive: route.fipsSensitive,
			Handler:       inventoryHandler,
		}); err != nil {
			return nil, err
		}
	}

	if err := register(
		HandlerRegistration{
			Path:          "/v1/sys/",
			Methods:       fullLogicalMethods,
			AuthRequired:  true,
			FIPSSensitive: false,
			Handler:       inventoryHandler,
		},
		HandlerRegistration{
			Path:          "/v1/",
			Methods:       fullLogicalMethods,
			AuthRequired:  true,
			FIPSSensitive: false,
			Handler:       inventoryHandler,
		},
		HandlerRegistration{
			Path:          "/ui/",
			Methods:       []string{http.MethodGet, http.MethodHead},
			AuthRequired:  false,
			FIPSSensitive: false,
			Handler:       inventoryHandler,
		},
		HandlerRegistration{
			Path:          "/robots.txt",
			Methods:       []string{http.MethodGet, http.MethodHead},
			AuthRequired:  false,
			FIPSSensitive: false,
			Handler:       inventoryHandler,
		},
		HandlerRegistration{
			Path:          "/ui",
			Methods:       []string{http.MethodGet},
			AuthRequired:  false,
			FIPSSensitive: false,
			Handler:       inventoryHandler,
		},
		HandlerRegistration{
			Path:          "/",
			Methods:       []string{http.MethodGet},
			AuthRequired:  false,
			FIPSSensitive: false,
			Handler:       inventoryHandler,
		},
		HandlerRegistration{
			Path:          "/v1/sys/metrics",
			Methods:       fullLogicalMethods,
			AuthRequired:  true,
			FIPSSensitive: false,
			Handler:       inventoryHandler,
		},
		HandlerRegistration{
			Path:          "/v1/sys/pprof/",
			Methods:       fullLogicalMethods,
			AuthRequired:  true,
			FIPSSensitive: false,
			Handler:       inventoryHandler,
		},
		HandlerRegistration{
			Path:          "/v1/sys/in-flight-req",
			Methods:       fullLogicalMethods,
			AuthRequired:  true,
			FIPSSensitive: false,
			Handler:       inventoryHandler,
		},
	); err != nil {
		return nil, err
	}

	return registry, nil
}
