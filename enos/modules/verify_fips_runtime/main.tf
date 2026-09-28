# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

# verify_fips_runtime is the WO-060 system integration check for FIPS-
# aligned operating posture. It follows the enos_remote_exec +
# shell-script-over-SSH pattern established in
# ../verify_secrets_engines/modules/read/ssh.tf: for every host in
# var.hosts (e.g. module.target_ec2_fips's `hosts` output), it runs
# scripts/verify-fips.sh over SSH to check OS-level FIPS mode
# (/proc/sys/crypto/fips_enabled) and the OpenSSL FIPS provider.
#
# When var.vault_addr is set, it additionally runs the same script locally
# (enos_local_exec) to verify the deployed Vault listener only negotiates
# Approved TLS cipher suites. That check runs locally -- rather than over
# SSH to var.hosts -- because the Vault instance under test in
# enos-scenario-fips.hcl (module.cloud_docker_vault_cluster) is deployed to
# the local Docker daemon of the Enos runner, not to the target_ec2_fips
# hosts; see enos-scenario-fips.hcl's description for the full rationale
# and the follow-on work required to co-locate both checks on one FIPS
# host.

terraform {
  required_providers {
    enos = {
      source = "registry.terraform.io/hashicorp-forge/enos"
    }
  }
}

resource "enos_remote_exec" "verify_fips_runtime" {
  for_each = var.hosts

  environment = {
    REQUIRE_OS_FIPS     = "true"
    VAULT_ADDR          = ""
    ALLOWED_TLS_CIPHERS = join(" ", var.allowed_tls_ciphers)
  }

  scripts = [abspath("${path.module}/scripts/verify-fips.sh")]

  transport = {
    ssh = {
      host = each.value.public_ip
    }
  }
}

resource "enos_local_exec" "verify_fips_runtime_tls" {
  count = var.vault_addr != "" ? 1 : 0

  environment = {
    REQUIRE_OS_FIPS     = "false"
    VAULT_ADDR          = var.vault_addr
    ALLOWED_TLS_CIPHERS = join(" ", var.allowed_tls_ciphers)
  }

  scripts = [abspath("${path.module}/scripts/verify-fips.sh")]
}
