// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

// Command handler-inventory generates an auditable JSON report of every
// HTTP endpoint handlerWithSettings' default case (http/handler.go)
// registers on Vault's HandlerRegistry, together with each endpoint's
// AuthRequired/FIPSSensitive authorization metadata. It satisfies the
// SOC2/SOX/HIPAA requirement for a complete, diffable inventory of Vault's
// access-controlled resources without needing a running Vault server: the
// report is built entirely from code (see http.BuildDefaultRegistry and
// http.GenerateInventoryReport). Run via `make handler-inventory`.
package main

import (
	"flag"
	"fmt"
	"os"

	vaulthttp "github.com/hashicorp/vault/http"
)

func main() {
	var (
		unauthRekey            bool
		unauthGenerateRoot     bool
		unauthDROperationToken bool
		outPath                string
	)
	flag.BoolVar(&unauthRekey, "unauth-rekey", false,
		"include the unauthenticated rekey endpoints, mirroring VAULT_DISABLE_DEFAULT_TOKEN_STORE-style core.GetEnableUnauthRekey()==true (default: false, matching Vault's default)")
	flag.BoolVar(&unauthGenerateRoot, "unauth-generate-root", false,
		"include the unauthenticated generate-root endpoints, mirroring core.GetEnableUnauthGenerateRoot()==true (default: false, matching Vault's default)")
	flag.BoolVar(&unauthDROperationToken, "unauth-dr-operation-token", false,
		"recorded for parity with handlerSettings; entDROperationRoutes is an enterprise-only registration this tool does not mount")
	flag.StringVar(&outPath, "out", "", "file to write the JSON report to (default: stdout)")
	flag.Parse()

	registry, err := vaulthttp.BuildDefaultRegistry(vaulthttp.InventorySettings{
		UnauthRekey:            unauthRekey,
		UnauthGenerateRoot:     unauthGenerateRoot,
		UnauthDROperationToken: unauthDROperationToken,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "handler-inventory: failed to build registry: %v\n", err)
		os.Exit(1)
	}

	report, err := vaulthttp.GenerateInventoryReport(registry)
	if err != nil {
		fmt.Fprintf(os.Stderr, "handler-inventory: failed to generate report: %v\n", err)
		os.Exit(1)
	}
	report = append(report, '\n')

	if outPath == "" {
		if _, err := os.Stdout.Write(report); err != nil {
			fmt.Fprintf(os.Stderr, "handler-inventory: failed to write to stdout: %v\n", err)
			os.Exit(1)
		}
		return
	}

	if err := os.WriteFile(outPath, report, 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "handler-inventory: failed to write %s: %v\n", outPath, err)
		os.Exit(1)
	}
	fmt.Fprintf(os.Stderr, "handler-inventory: wrote %s\n", outPath)
}
