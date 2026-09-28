// Copyright IBM Corp. 2016, 2026
// SPDX-License-Identifier: BUSL-1.1

package cmd

import "github.com/spf13/cobra"

func newFipsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "fips",
		Short: "FIPS 140-3 compliance evidence commands",
		Long:  "Commands for assembling FIPS 140-3 compliance evidence artifacts",
	}
	cmd.AddCommand(newFipsEvidenceCmd())
	return cmd
}
