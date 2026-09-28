# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

output "cluster_name" {
  value = local.cluster_name
}

output "hosts" {
  description = "The FIPS-enabled ec2 instance target hosts"
  value       = local.hosts
}

output "security_group_id" {
  description = "The target security group ID"
  value       = aws_security_group.target.id
}

output "fips_verification" {
  description = "Per-host stdout of the /proc/sys/crypto/fips_enabled check, used as FIPS-aligned-posture evidence"
  value       = { for idx, host in local.hosts : idx => enos_remote_exec.verify_fips_reboot[idx].stdout }
}
