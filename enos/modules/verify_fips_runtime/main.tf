# Copyright IBM Corp. 2016, 2026
# SPDX-License-Identifier: BUSL-1.1

# verify_fips_runtime is the WO-061 system integration check for quality
# gate FIPS-RUNTIME-001: it SSHs into each target host and invokes the
# "vault fips-verify" CLI command (command/fips_verify.go), which wraps
# vault/fipsverify.CollectEvidence, to collect a dated, structured runtime
# FIPS evidence document directly from an already-installed Vault binary --
# never inferred from a configuration flag alone.
#
# Unlike enos/modules/verify_fips_startup (WO-055), which builds and boots
# a fresh container to observe Vault's *startup* verification log line,
# this module targets an already-running (or at least already-installed)
# Vault deployment and asserts on the *evidence document* itself: OS-level
# FIPS mode, active crypto provider, and negotiated/configured TLS
# settings, via scripts/verify-fips-runtime.sh's jq assertions.
#
# This module does not provision the target host or the FIPS-enabled RHEL 9
# runner it is meant to run against -- that is WO-060's (Enos FIPS
# infrastructure provisioning) responsibility, and is out of this story's
# scope. Wiring this module into a named Enos scenario is also left to that
# infrastructure work.

terraform {
  required_providers {
    enos = {
      source = "registry.terraform.io/hashicorp-forge/enos"
    }
  }
}

variable "hosts" {
  description = "The target machines to collect FIPS runtime evidence from"
  type = map(object({
    ipv6       = string
    private_ip = string
    public_ip  = string
  }))
}

variable "vault_install_dir" {
  type        = string
  description = "The directory on each target host where the vault binary is installed"
  default     = "/opt/vault/bin"
}

variable "vault_config_path" {
  type        = string
  description = "Path, on each target host, to the Vault server configuration file to read the active listener's TLS settings from. If empty, TLS evidence is omitted."
  default     = ""
}

resource "enos_remote_exec" "verify_fips_runtime" {
  for_each = var.hosts

  environment = {
    VAULT_INSTALL_DIR = var.vault_install_dir
    VAULT_CONFIG_PATH = var.vault_config_path
  }

  scripts = [abspath("${path.module}/scripts/verify-fips-runtime.sh")]

  transport = {
    ssh = {
      host = each.value.public_ip
    }
  }
}

output "evidence_json" {
  value       = { for host, res in enos_remote_exec.verify_fips_runtime : host => res.stdout }
  description = "The FIPS runtime evidence JSON document collected from each host, plus this script's PASS/FAIL summary"
}
