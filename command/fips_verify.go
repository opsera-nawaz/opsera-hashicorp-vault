// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package command

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/hashicorp/cli"
	extTLSUtil "github.com/hashicorp/go-secure-stdlib/tlsutil"
	server "github.com/hashicorp/vault/helper/serverconfig"
	"github.com/hashicorp/vault/internalshared/configutil"
	"github.com/hashicorp/vault/vault/fipsverify"
	"github.com/posener/complete"
)

var (
	_ cli.Command             = (*FIPSVerifyCommand)(nil)
	_ cli.CommandAutocomplete = (*FIPSVerifyCommand)(nil)
)

// FIPSVerifyCommand prints a runtime FIPS verification evidence document:
// the OS-level FIPS mode flag, the active crypto provider, the configured
// listener TLS settings, and the compile-time FIPS build tag state. See
// vault/fipsverify for what each field means and how it is derived.
//
// This is a standalone, read-only, local CLI command: it never starts a
// listener and never makes a network call, so it cannot bypass the
// HandleRequest authorization pipeline the way a new HTTP endpoint could.
// It exists so the Enos verify_fips_runtime module (enos/modules/
// verify_fips_runtime), and any operator or CI evidence pipeline, has a
// stable, scriptable way to invoke vault/fipsverify.CollectEvidence
// against an already-installed Vault binary, e.g. over SSH.
type FIPSVerifyCommand struct {
	*BaseCommand

	flagConfig string
}

func (c *FIPSVerifyCommand) Synopsis() string {
	return "Prints runtime FIPS verification evidence as JSON"
}

func (c *FIPSVerifyCommand) Help() string {
	helpText := `
Usage: vault fips-verify [-config=<path>]

  Collects and prints, as JSON, this host's runtime FIPS verification
  evidence: the OS-level FIPS mode flag read from
  /proc/sys/crypto/fips_enabled, the active Go crypto provider
  ("boringcrypto" or "go-stdlib"), the compile-time FIPS build tag state,
  and -- when -config is given -- the first TLS-enabled listener's
  configured TLS minimum/maximum version and cipher suites.

  This command reports FIPS-aligned runtime *state*. It never claims Vault
  is "FIPS validated" or "FIPS certified".

      $ vault fips-verify -config=/etc/vault.d/vault.hcl

  The exit status is non-zero if any part of evidence collection failed
  (e.g. the OS-level FIPS flag could not be read); the partial evidence
  that was collected is still printed.
`
	return strings.TrimSpace(helpText)
}

func (c *FIPSVerifyCommand) Flags() *FlagSets {
	set := NewFlagSets(c.UI)
	f := set.NewFlagSet("Command Options")

	f.StringVar(&StringVar{
		Name:   "config",
		Target: &c.flagConfig,
		Usage: "Path to a Vault server configuration file to read the active listener's " +
			"TLS settings from. If unset, TLS configuration is omitted from the evidence.",
	})

	return set
}

func (c *FIPSVerifyCommand) AutocompleteArgs() complete.Predictor {
	return complete.PredictNothing
}

func (c *FIPSVerifyCommand) AutocompleteFlags() complete.Flags {
	return c.Flags().Completions()
}

func (c *FIPSVerifyCommand) Run(args []string) int {
	f := c.Flags()
	if err := f.Parse(args); err != nil {
		c.UI.Error(err.Error())
		return 1
	}

	var tlsConfig *tls.Config
	if c.flagConfig != "" {
		cfg, err := server.LoadConfig(c.flagConfig)
		if err != nil {
			c.UI.Error(fmt.Sprintf("Error loading configuration from %s: %s", c.flagConfig, err))
			return 1
		}
		tlsConfig = tlsConfigFromListeners(cfg.Listeners)
	}

	evidence, err := fipsverify.CollectEvidence(context.Background(), tlsConfig)
	if evidence == nil {
		c.UI.Error(fmt.Sprintf("Error collecting FIPS evidence: %s", err))
		return 1
	}

	out, marshalErr := json.MarshalIndent(evidence, "", "  ")
	if marshalErr != nil {
		c.UI.Error(fmt.Sprintf("Error marshaling FIPS evidence: %s", marshalErr))
		return 1
	}
	c.UI.Output(string(out))

	if err != nil {
		return 1
	}
	return 0
}

// tlsConfigFromListeners builds a *tls.Config carrying only the fields
// vault/fipsverify's TLS evidence extraction reads (MinVersion, MaxVersion,
// CipherSuites) from the first TLS-enabled listener in listeners, using the
// same parsed configuration internalshared/configutil.ParseListeners
// already produced for "vault server" -- so this command records the
// actual configured values from the Vault listener, not Go's unconfigured
// defaults. Returns nil if no TLS-enabled listener is found.
func tlsConfigFromListeners(listeners []*configutil.Listener) *tls.Config {
	for _, l := range listeners {
		if l == nil || l.TLSDisable {
			continue
		}

		cfg := &tls.Config{CipherSuites: l.TLSCipherSuites}
		if v, ok := extTLSUtil.TLSLookup[l.TLSMinVersion]; ok {
			cfg.MinVersion = v
		}
		if v, ok := extTLSUtil.TLSLookup[l.TLSMaxVersion]; ok {
			cfg.MaxVersion = v
		}
		return cfg
	}
	return nil
}
