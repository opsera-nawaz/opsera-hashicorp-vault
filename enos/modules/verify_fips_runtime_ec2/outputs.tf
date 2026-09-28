# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

output "os_fips_check_results" {
  description = "Per-host stdout of the OS-level FIPS mode + OpenSSL FIPS provider checks"
  value       = { for k, v in enos_remote_exec.verify_fips_runtime : k => v.stdout }
}

output "tls_negotiation_result" {
  description = "Stdout of the Vault TLS negotiation check; empty string when var.vault_addr was not set"
  value       = length(enos_local_exec.verify_fips_runtime_tls) > 0 ? enos_local_exec.verify_fips_runtime_tls[0].stdout : ""
}
