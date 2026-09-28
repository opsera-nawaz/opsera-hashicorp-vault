// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: BUSL-1.1

// Command generate_api_snapshot parses http/handler.go with go/parser and
// writes a golden-file contract snapshot to
// tests/fixtures/api_contract_snapshot.json.
//
// It is the regression-detection baseline for WO-040 (Integration test
// suite validating 489 API endpoint backward compatibility): every
// HandlerRegistration composite literal registered inside
// handlerWithSettings() - whether passed directly to registry.Register or
// declared as an element of a []HandlerRegistration{...} slice consumed by
// a for-range loop - is extracted statically from source, without booting a
// Vault core. This is deliberate: introspecting the *live* registry would
// only prove the golden file matches whatever handler.go currently does,
// which is circular for a contract meant to catch source-level drift. AST
// extraction instead gives an independent, human-readable record of what
// handler.go's source says it registers, so a future refactor that changes
// handler.go without updating the API is caught by a snapshot diff.
//
// Usage:
//
//	go run ./tools/generate_api_snapshot > tests/fixtures/api_contract_snapshot.json
//
// or, per WO-040's constraint that regeneration must be an explicit manual
// step:
//
//	make api-snapshot
//
// Known limitations (documented rather than silently papered over):
//   - Path segments built from the "operatorNamespace" runtime variable
//     (e.g. "/v1/" + operatorNamespace + "sys/init") are resolved assuming
//     the root namespace (operatorNamespace == ""), matching Vault
//     Community Edition, which has no non-root namespaces. Namespace
//     prefixing is a paid Enterprise feature and cannot be exercised here.
//   - Recovery-mode endpoints (props.RecoveryMode branch) use a distinct
//     recovery-token authentication mechanism that predates AuthRequired;
//     they are recorded with a "recovery_mode" forwarding_behavior and
//     their methods are inferred from their handler names, not extracted
//     from an explicit Methods field (that branch still uses raw
//     mux.Handle calls without one - see http/handler.go's RecoveryMode
//     case).
package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"sort"
	"strconv"
	"strings"
)

const sourceFile = "http/handler.go"

// endpoint is one entry in the golden file's "endpoints" array.
type endpoint struct {
	Path                 string   `json:"path"`
	Methods              []string `json:"methods"`
	AuthRequired         bool     `json:"auth_required"`
	FIPSSensitive        bool     `json:"fips_sensitive"`
	ForwardingBehavior   string   `json:"forwarding_behavior"`
	HandlerName          string   `json:"handler_name"`
	ContentType          string   `json:"content_type"`
	Category             string   `json:"category"`
	ConditionalOnSetting string   `json:"conditional_on_setting,omitempty"`
}

// topLevelRoute mirrors http/handler.go's injectDataIntoTopRoutes element
// type, parsed from source rather than imported (this tool intentionally
// has no dependency on package http/vault so it can run standalone).
type topLevelRoute struct {
	path          string
	fipsSensitive bool
}

// httpMethodConsts maps the net/http method constant identifiers used
// throughout handler.go to their string values, so http.MethodGet et al.
// resolve without importing net/http.
var httpMethodConsts = map[string]string{
	"MethodGet":     "GET",
	"MethodHead":    "HEAD",
	"MethodPost":    "POST",
	"MethodPut":     "PUT",
	"MethodPatch":   "PATCH",
	"MethodDelete":  "DELETE",
	"MethodConnect": "CONNECT",
	"MethodOptions": "OPTIONS",
	"MethodTrace":   "TRACE",
}

type snapshot struct {
	SchemaVersion   int             `json:"schema_version"`
	GeneratedBy     string          `json:"generated_by"`
	SourceFile      string          `json:"source_file"`
	EndpointCount   int             `json:"endpoint_count"`
	JSONDoSLimits   jsonDoSLimits   `json:"json_dos_limits"`
	KnownHeaders    knownHeaders    `json:"known_headers"`
	ForwardingPaths forwardingPaths `json:"forwarding_paths"`
	Endpoints       []endpoint      `json:"endpoints"`
}

type jsonDoSLimits struct {
	DefaultMaxRequestSize          int64 `json:"default_max_request_size"`
	DefaultMaxTokenHeaderSize      int64 `json:"default_max_token_header_size"`
	CustomMaxJSONDepth             int64 `json:"custom_max_json_depth"`
	CustomMaxJSONStringValueLength int64 `json:"custom_max_json_string_value_length"`
	CustomMaxJSONObjectEntryCount  int64 `json:"custom_max_json_object_entry_count"`
	CustomMaxJSONArrayElementCount int64 `json:"custom_max_json_array_element_count"`
	CustomMaxJSONToken             int64 `json:"custom_max_json_token"`
}

type knownHeaders struct {
	// Request headers Vault reads to drive per-request behavior.
	Request []string `json:"request"`
	// Response headers Vault may set, conditional on the endpoint's
	// forwarding/wrapping/namespace context.
	Response []string `json:"response"`
}

type forwardingPaths struct {
	AlwaysRedirect          []string            `json:"always_redirect"`
	AlwaysRedirectExcluded  []string            `json:"always_redirect_excluded"`
	PerMethodAlwaysRedirect map[string][]string `json:"per_method_always_redirect"`
}

func main() {
	src, err := os.ReadFile(sourceFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "generate_api_snapshot: reading %s: %v\n", sourceFile, err)
		os.Exit(1)
	}

	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, sourceFile, src, parser.ParseComments)
	if err != nil {
		fmt.Fprintf(os.Stderr, "generate_api_snapshot: parsing %s: %v\n", sourceFile, err)
		os.Exit(1)
	}

	x := &extractor{fset: fset, src: src}
	x.collectPackageVars(file)

	var fn *ast.FuncDecl
	for _, decl := range file.Decls {
		if fd, ok := decl.(*ast.FuncDecl); ok && fd.Name.Name == "handlerWithSettings" {
			fn = fd
			break
		}
	}
	if fn == nil {
		fmt.Fprintln(os.Stderr, "generate_api_snapshot: handlerWithSettings not found in "+sourceFile)
		os.Exit(1)
	}

	endpoints := x.extractRegistrations(fn)
	endpoints = append(endpoints, x.recoveryModeEndpoints()...)

	sort.Slice(endpoints, func(i, j int) bool {
		if endpoints[i].Path != endpoints[j].Path {
			return endpoints[i].Path < endpoints[j].Path
		}
		return strings.Join(endpoints[i].Methods, ",") < strings.Join(endpoints[j].Methods, ",")
	})

	snap := snapshot{
		SchemaVersion: 1,
		GeneratedBy:   "tools/generate_api_snapshot (go run ./tools/generate_api_snapshot, or `make api-snapshot`)",
		SourceFile:    sourceFile,
		EndpointCount: len(endpoints),
		JSONDoSLimits: jsonDoSLimits{
			DefaultMaxRequestSize:          x.constInt("DefaultMaxRequestSize"),
			DefaultMaxTokenHeaderSize:      x.constInt("DefaultMaxTokenHeaderSize"),
			CustomMaxJSONDepth:             x.constInt("CustomMaxJSONDepth"),
			CustomMaxJSONStringValueLength: x.constInt("CustomMaxJSONStringValueLength"),
			CustomMaxJSONObjectEntryCount:  x.constInt("CustomMaxJSONObjectEntryCount"),
			CustomMaxJSONArrayElementCount: x.constInt("CustomMaxJSONArrayElementCount"),
			CustomMaxJSONToken:             x.constInt("CustomMaxJSONToken"),
		},
		KnownHeaders: knownHeaders{
			Request: []string{"X-Vault-Token"},
			Response: []string{
				x.constString("VaultIndexHeaderName"),
				x.constString("VaultForwardHeaderName"),
				"X-Vault-Wrap-TTL",
				"X-Vault-Namespace",
			},
		},
		ForwardingPaths: x.forwardingPaths(file),
		Endpoints:       endpoints,
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(snap); err != nil {
		fmt.Fprintf(os.Stderr, "generate_api_snapshot: encoding JSON: %v\n", err)
		os.Exit(1)
	}
}

type extractor struct {
	fset *token.FileSet
	src  []byte

	fullLogicalMethods []string
	injectRoutes       []topLevelRoute
	consts             map[string]ast.Expr
}

func (x *extractor) text(n ast.Node) string {
	start := x.fset.Position(n.Pos()).Offset
	end := x.fset.Position(n.End()).Offset
	return string(x.src[start:end])
}

// collectPackageVars resolves the package-level vars and consts this
// extractor needs to interpret registrations: fullLogicalMethods,
// injectDataIntoTopRoutes, and the JSON/limit constants.
func (x *extractor) collectPackageVars(file *ast.File) {
	x.consts = make(map[string]ast.Expr)

	for _, decl := range file.Decls {
		gd, ok := decl.(*ast.GenDecl)
		if !ok {
			continue
		}
		for _, spec := range gd.Specs {
			vs, ok := spec.(*ast.ValueSpec)
			if !ok || len(vs.Names) != 1 || len(vs.Values) != 1 {
				continue
			}
			name := vs.Names[0].Name
			switch {
			case gd.Tok == token.CONST:
				x.consts[name] = vs.Values[0]
			case name == "fullLogicalMethods":
				x.fullLogicalMethods = x.resolveMethodsLiteral(vs.Values[0])
			case name == "injectDataIntoTopRoutes":
				x.injectRoutes = x.resolveInjectRoutes(vs.Values[0])
			}
		}
	}
}

func (x *extractor) resolveMethodsLiteral(expr ast.Expr) []string {
	cl, ok := expr.(*ast.CompositeLit)
	if !ok {
		return nil
	}
	var methods []string
	for _, elt := range cl.Elts {
		if m, ok := x.methodConst(elt); ok {
			methods = append(methods, m)
		}
	}
	return methods
}

func (x *extractor) methodConst(expr ast.Expr) (string, bool) {
	switch e := expr.(type) {
	case *ast.BasicLit:
		if e.Kind == token.STRING {
			s, err := strconv.Unquote(e.Value)
			return s, err == nil
		}
	case *ast.SelectorExpr:
		if ident, ok := e.X.(*ast.Ident); ok && ident.Name == "http" {
			if v, ok := httpMethodConsts[e.Sel.Name]; ok {
				return v, true
			}
		}
	}
	return "", false
}

func (x *extractor) resolveInjectRoutes(expr ast.Expr) []topLevelRoute {
	cl, ok := expr.(*ast.CompositeLit)
	if !ok {
		return nil
	}
	var routes []topLevelRoute
	for _, elt := range cl.Elts {
		rcl, ok := elt.(*ast.CompositeLit)
		if !ok {
			continue
		}
		var r topLevelRoute
		for _, e := range rcl.Elts {
			kv, ok := e.(*ast.KeyValueExpr)
			if !ok {
				continue
			}
			key, ok := kv.Key.(*ast.Ident)
			if !ok {
				continue
			}
			switch key.Name {
			case "path":
				if s, ok := x.stringLit(kv.Value); ok {
					r.path = s
				}
			case "fipsSensitive":
				r.fipsSensitive = x.boolLit(kv.Value)
			}
		}
		routes = append(routes, r)
	}
	return routes
}

func (x *extractor) stringLit(expr ast.Expr) (string, bool) {
	lit, ok := expr.(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		return "", false
	}
	s, err := strconv.Unquote(lit.Value)
	return s, err == nil
}

func (x *extractor) boolLit(expr ast.Expr) bool {
	ident, ok := expr.(*ast.Ident)
	return ok && ident.Name == "true"
}

func (x *extractor) constString(name string) string {
	expr, ok := x.consts[name]
	if !ok {
		return ""
	}
	s, _ := x.stringLit(expr)
	return s
}

// constInt evaluates a const's value expression, handling the small
// arithmetic (e.g. "32 * 1024 * 1024") handler.go uses for its size limits.
func (x *extractor) constInt(name string) int64 {
	expr, ok := x.consts[name]
	if !ok {
		return 0
	}
	return evalIntExpr(expr)
}

func evalIntExpr(expr ast.Expr) int64 {
	switch e := expr.(type) {
	case *ast.BasicLit:
		if e.Kind == token.INT {
			v, _ := strconv.ParseInt(e.Value, 0, 64)
			return v
		}
	case *ast.BinaryExpr:
		l, r := evalIntExpr(e.X), evalIntExpr(e.Y)
		switch e.Op {
		case token.MUL:
			return l * r
		case token.ADD:
			return l + r
		case token.SUB:
			return l - r
		}
	case *ast.ParenExpr:
		return evalIntExpr(e.X)
	}
	return 0
}

// registrationTemplate is the raw, pre-expansion shape of one
// HandlerRegistration composite literal found in source.
type registrationTemplate struct {
	pathLiteral   string
	pathUsesRoute bool
	methods       []string
	authRequired  bool
	fipsSensitive bool
	fipsUsesRoute bool
	handlerText   string
}

// extractRegistrations walks fn's body for every HandlerRegistration
// composite literal - whether passed directly to registry.Register or
// declared as an element of a []HandlerRegistration{...} slice consumed by
// a for-range loop - and returns the fully expanded, resolved endpoint
// list. It also tags each endpoint with the conditional setting (if any)
// guarding its registration and a best-effort category, by tracking the
// enclosing if-statement's condition text as it walks.
func (x *extractor) extractRegistrations(fn *ast.FuncDecl) []endpoint {
	var out []endpoint

	var walk func(n ast.Node, conditional string)
	walk = func(n ast.Node, conditional string) {
		switch stmt := n.(type) {
		case *ast.IfStmt:
			cond := ""
			switch c := stmt.Cond.(type) {
			case *ast.SelectorExpr:
				cond = c.Sel.Name
			case *ast.Ident:
				cond = c.Name
			}
			// Init covers "if err := registry.Register(...); err != nil"
			// - the registration call itself lives in Init, not Cond/Body,
			// for every single (non-loop) Register call in handler.go.
			if stmt.Init != nil {
				walk(stmt.Init, orElse(cond, conditional))
			}
			walk(stmt.Body, orElse(cond, conditional))
			if stmt.Else != nil {
				walk(stmt.Else, conditional)
			}
			return
		case *ast.BlockStmt:
			for _, s := range stmt.List {
				walk(s, conditional)
			}
			return
		case *ast.RangeStmt:
			// The []HandlerRegistration{...} literal being ranged over is
			// the range expression itself (stmt.X) for every batch that
			// does "for _, reg := range []HandlerRegistration{...} {
			// registry.Register(reg) }"; the loop body only re-references
			// the loop variable, so it must be walked too.
			walk(stmt.X, conditional)
			walk(stmt.Body, conditional)
			return
		case *ast.SwitchStmt:
			walk(stmt.Body, conditional)
			return
		case *ast.CaseClause:
			for _, s := range stmt.Body {
				walk(s, conditional)
			}
			return
		case *ast.ExprStmt:
			walk(stmt.X, conditional)
			return
		case *ast.AssignStmt:
			for _, rhs := range stmt.Rhs {
				walk(rhs, conditional)
			}
			return
		case *ast.CallExpr:
			for _, arg := range stmt.Args {
				walk(arg, conditional)
			}
			return
		case *ast.CompositeLit:
			if ident, ok := stmt.Type.(*ast.Ident); ok && ident.Name == "HandlerRegistration" {
				tmpl := x.parseRegistrationLit(stmt)
				out = append(out, x.expand(tmpl, conditional)...)
				return
			}
			if arr, ok := stmt.Type.(*ast.ArrayType); ok {
				if eltIdent, ok := arr.Elt.(*ast.Ident); ok && eltIdent.Name == "HandlerRegistration" {
					for _, elt := range stmt.Elts {
						if eltCl, ok := elt.(*ast.CompositeLit); ok {
							tmpl := x.parseRegistrationLit(eltCl)
							out = append(out, x.expand(tmpl, conditional)...)
						}
					}
					return
				}
			}
		}
	}

	walk(fn.Body, "")
	return out
}

func orElse(preferred, fallback string) string {
	if preferred != "" {
		return preferred
	}
	return fallback
}

func (x *extractor) parseRegistrationLit(cl *ast.CompositeLit) registrationTemplate {
	var t registrationTemplate
	for _, elt := range cl.Elts {
		kv, ok := elt.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		key, ok := kv.Key.(*ast.Ident)
		if !ok {
			continue
		}
		switch key.Name {
		case "Path":
			t.pathLiteral, t.pathUsesRoute = x.resolvePathExpr(kv.Value)
		case "Methods":
			if ident, ok := kv.Value.(*ast.Ident); ok && ident.Name == "fullLogicalMethods" {
				t.methods = x.fullLogicalMethods
			} else {
				t.methods = x.resolveMethodsLiteral(kv.Value)
			}
		case "AuthRequired":
			t.authRequired = x.boolLit(kv.Value)
		case "FIPSSensitive":
			if sel, ok := kv.Value.(*ast.SelectorExpr); ok {
				if xIdent, ok := sel.X.(*ast.Ident); ok && xIdent.Name == "route" && sel.Sel.Name == "fipsSensitive" {
					t.fipsUsesRoute = true
					continue
				}
			}
			t.fipsSensitive = x.boolLit(kv.Value)
		case "Handler":
			t.handlerText = strings.Join(strings.Fields(x.text(kv.Value)), " ")
		}
	}
	return t
}

// resolvePathExpr evaluates a Path field expression. String concatenation
// with the "operatorNamespace" runtime variable resolves that variable to
// "" (root namespace - see package doc comment). A "route.path" selector
// (the injectDataIntoTopRoutes loop body) is reported via usesRoute so the
// caller expands one endpoint per route.
func (x *extractor) resolvePathExpr(expr ast.Expr) (string, bool) {
	switch e := expr.(type) {
	case *ast.BasicLit:
		s, _ := x.stringLit(e)
		return s, false
	case *ast.Ident:
		if e.Name == "operatorNamespace" {
			return "", false
		}
	case *ast.SelectorExpr:
		if xIdent, ok := e.X.(*ast.Ident); ok && xIdent.Name == "route" && e.Sel.Name == "path" {
			return "", true
		}
	case *ast.BinaryExpr:
		l, lRoute := x.resolvePathExpr(e.X)
		r, rRoute := x.resolvePathExpr(e.Y)
		return l + r, lRoute || rRoute
	}
	return "", false
}

func (x *extractor) expand(t registrationTemplate, conditional string) []endpoint {
	classify := func(path string) (forwarding, category, contentType string) {
		switch {
		case strings.Contains(t.handlerText, "handleRequestForwarding("):
			forwarding = "forwarded"
		case strings.Contains(t.handlerText, "handleLogicalNoForward("):
			forwarding = "no_forward"
		default:
			forwarding = "static"
		}
		switch {
		case strings.HasPrefix(path, "/ui") || path == "/robots.txt" || path == "/":
			contentType = "text/html"
			category = "ui"
		default:
			contentType = "application/json"
			category = "api"
		}
		return
	}
	handlerName := t.handlerText
	if idx := strings.IndexAny(handlerName, "(,"); idx > 0 {
		handlerName = handlerName[:idx]
	}

	if !t.pathUsesRoute && !t.fipsUsesRoute {
		forwarding, category, contentType := classify(t.pathLiteral)
		return []endpoint{{
			Path:                 t.pathLiteral,
			Methods:              t.methods,
			AuthRequired:         t.authRequired,
			FIPSSensitive:        t.fipsSensitive,
			ForwardingBehavior:   forwarding,
			HandlerName:          handlerName,
			ContentType:          contentType,
			Category:             category,
			ConditionalOnSetting: conditional,
		}}
	}

	// injectDataIntoTopRoutes expansion: one endpoint per route.
	out := make([]endpoint, 0, len(x.injectRoutes))
	for _, r := range x.injectRoutes {
		forwarding, _, contentType := classify(r.path)
		out = append(out, endpoint{
			Path:                 r.path,
			Methods:              t.methods,
			AuthRequired:         t.authRequired,
			FIPSSensitive:        r.fipsSensitive,
			ForwardingBehavior:   forwarding,
			HandlerName:          handlerName,
			ContentType:          contentType,
			Category:             "inject_data_top_route",
			ConditionalOnSetting: conditional,
		})
	}
	return out
}

// recoveryModeEndpoints hardcodes the three raw mux.Handle registrations in
// handlerWithSettings' props.RecoveryMode branch. They are excluded from
// the HandlerRegistry by design (see http/handler.go's comment on that
// branch), use a separate recovery-token auth mechanism instead of
// AuthRequired, and their handlers don't declare an explicit Methods list
// the way registry-based ones do - so their methods are documented here
// from the handler names rather than extracted from an AST field.
func (x *extractor) recoveryModeEndpoints() []endpoint {
	return []endpoint{
		{
			Path:               "/v1/sys/raw/",
			Methods:            []string{"GET", "PUT", "DELETE", "LIST"},
			AuthRequired:       false,
			FIPSSensitive:      false,
			ForwardingBehavior: "recovery_mode",
			HandlerName:        "handleLogicalRecovery",
			ContentType:        "application/json",
			Category:           "recovery_mode",
		},
		{
			Path:               "/v1/sys/generate-recovery-token/attempt",
			Methods:            []string{"GET", "PUT", "POST", "DELETE"},
			AuthRequired:       false,
			FIPSSensitive:      true,
			ForwardingBehavior: "recovery_mode",
			HandlerName:        "handleSysGenerateRootAttempt",
			ContentType:        "application/json",
			Category:           "recovery_mode",
		},
		{
			Path:               "/v1/sys/generate-recovery-token/update",
			Methods:            []string{"PUT", "POST"},
			AuthRequired:       false,
			FIPSSensitive:      true,
			ForwardingBehavior: "recovery_mode",
			HandlerName:        "handleSysGenerateRootUpdate",
			ContentType:        "application/json",
			Category:           "recovery_mode",
		},
	}
}

// forwardingPaths parses init()'s alwaysRedirectPaths.AddPaths(...) call and
// the perMethodRedirectRawPaths package var to reconstruct AC4's forwarding
// contract (alwaysRedirectPaths / perMethodAlwaysRedirectPaths).
func (x *extractor) forwardingPaths(file *ast.File) forwardingPaths {
	fp := forwardingPaths{PerMethodAlwaysRedirect: map[string][]string{}}

	for _, decl := range file.Decls {
		fd, ok := decl.(*ast.FuncDecl)
		if !ok || fd.Name.Name != "init" || fd.Recv != nil {
			continue
		}
		ast.Inspect(fd.Body, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || sel.Sel.Name != "AddPaths" {
				return true
			}
			recv, ok := sel.X.(*ast.Ident)
			if !ok || recv.Name != "alwaysRedirectPaths" || len(call.Args) != 1 {
				return true
			}
			cl, ok := call.Args[0].(*ast.CompositeLit)
			if !ok {
				return true
			}
			for _, elt := range cl.Elts {
				s, ok := x.stringLit(elt)
				if !ok {
					continue
				}
				if strings.HasPrefix(s, "!") {
					fp.AlwaysRedirectExcluded = append(fp.AlwaysRedirectExcluded, strings.TrimPrefix(s, "!"))
				} else {
					fp.AlwaysRedirect = append(fp.AlwaysRedirect, s)
				}
			}
			return false
		})
	}

	for _, decl := range file.Decls {
		gd, ok := decl.(*ast.GenDecl)
		if !ok {
			continue
		}
		for _, spec := range gd.Specs {
			vs, ok := spec.(*ast.ValueSpec)
			if !ok || len(vs.Names) != 1 || vs.Names[0].Name != "perMethodRedirectRawPaths" || len(vs.Values) != 1 {
				continue
			}
			cl, ok := vs.Values[0].(*ast.CompositeLit)
			if !ok {
				continue
			}
			for _, elt := range cl.Elts {
				kv, ok := elt.(*ast.KeyValueExpr)
				if !ok {
					continue
				}
				method, ok := x.methodConst(kv.Key)
				if !ok {
					continue
				}
				valsCl, ok := kv.Value.(*ast.CompositeLit)
				if !ok {
					continue
				}
				for _, v := range valsCl.Elts {
					if s, ok := x.stringLit(v); ok {
						fp.PerMethodAlwaysRedirect[method] = append(fp.PerMethodAlwaysRedirect[method], s)
					}
				}
			}
		}
	}

	return fp
}
