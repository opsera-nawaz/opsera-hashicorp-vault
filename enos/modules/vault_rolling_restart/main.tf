# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

# vault_rolling_restart performs a one-node-at-a-time, binary-swap-style
# restart of every host in `var.hosts`, in the order supplied, waiting
# `restart_delay_seconds` between nodes and (for non-auto-unseal seal types)
# re-unsealing each node before moving on to the next one. It adapts the
# staged-restart pattern from ../vault_upgrade (which restarts "all
# followers, then the leader" as two batches) to instead restart every node
# individually, which more faithfully simulates a Kubernetes StatefulSet
# rolling deployment restart used to ship the WO-024/WO-015 modernization
# changes (see enos/enos-scenario-raft-regression.hcl, WO-038).
terraform {
  required_providers {
    enos = {
      source = "registry.terraform.io/hashicorp-forge/enos"
    }
  }
}

variable "hosts" {
  type = list(object({
    ipv6       = string
    private_ip = string
    public_ip  = string
  }))
  description = "The ordered list of vault cluster hosts to restart, one at a time"
}

variable "vault_addr" {
  type        = string
  description = "The local vault API listen address"
}

variable "vault_install_dir" {
  type        = string
  description = "The directory where the Vault binary will be installed"
}

variable "vault_seal_type" {
  type        = string
  description = "The Vault seal type"
}

variable "vault_unseal_keys" {
  type        = list(string)
  description = "The keys to use to unseal Vault when not using auto-unseal"
  default     = null
}

variable "restart_delay_seconds" {
  type        = number
  description = "How many seconds to wait after each node restarts (and re-unseals) before restarting the next node"
  default     = 10
}

resource "enos_remote_exec" "rolling_restart_node" {
  count = length(var.hosts)

  environment = {
    VAULT_ADDR            = var.vault_addr
    VAULT_INSTALL_DIR     = var.vault_install_dir
    VAULT_SEAL_TYPE       = var.vault_seal_type
    VAULT_UNSEAL_KEYS     = var.vault_seal_type == "shamir" ? join(",", coalesce(var.vault_unseal_keys, [])) : ""
    RESTART_DELAY_SECONDS = var.restart_delay_seconds

    # This reference is load-bearing, not just documentation: Terraform only
    # serializes count-indexed resource instances when a later instance's
    # configuration actually references an earlier instance's output. Every
    # node after the first is wired to the previous node's completion id so
    # that node N+1 never starts restarting until node N has restarted,
    # (re)unsealed, and waited out restart_delay_seconds. Without this,
    # Terraform would restart every host in var.hosts concurrently, which is
    # a simultaneous-outage simulation, not a rolling restart.
    ROLLING_RESTART_PREDECESSOR_ID = count.index == 0 ? "none" : enos_remote_exec.rolling_restart_node[count.index - 1].id
  }

  scripts = [abspath("${path.module}/scripts/rolling-restart-node.sh")]

  transport = {
    ssh = {
      host = var.hosts[count.index].public_ip
    }
  }
}

output "restarted_node_ids" {
  description = "The enos_remote_exec resource ids for each node restart, in restart order"
  value       = [for r in enos_remote_exec.rolling_restart_node : r.id]
}
