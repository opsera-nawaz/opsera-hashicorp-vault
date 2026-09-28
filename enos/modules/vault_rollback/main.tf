# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

# vault_rollback performs the reverse of ../vault_upgrade: instead of installing a new candidate
# build, it reinstalls a pinned pre-modernization Vault release (WO-052). It reuses the exact same
# staged-restart order as ../vault_upgrade -- all followers first, the leader last -- because that
# order is what makes an in-place binary change on a live Raft cluster safe in either direction:
# followers can be restarted and re-unsealed without an availability gap (Raft keeps serving reads
# and writes through the remaining quorum), and the leader is only restarted once every follower
# has already proven the incoming binary can start, rejoin Raft, and unseal successfully. WO-052's
# "swap the binary on each node in reverse order (leader last)" therefore describes the artifact
# direction (new binary -> pinned old binary), not a change to the follower/leader restart order.
terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
    enos = {
      source  = "registry.terraform.io/hashicorp-forge/enos"
      version = ">= 0.5.4"
    }
  }
}

variable "hosts" {
  type = map(object({
    ipv6       = string
    private_ip = string
    public_ip  = string
  }))
  description = "The vault cluster instances that were created"
}

variable "ip_version" {
  type        = number
  description = "The IP version used for the Vault TCP listener"

  validation {
    condition     = contains([4, 6], var.ip_version)
    error_message = "The ip_version must be either 4 or 6"
  }
}

variable "vault_addr" {
  type        = string
  description = "The local vault API listen address"
}

variable "rollback_artifactory_release" {
  type = object({
    username = string
    token    = string
    url      = string
    sha256   = string
  })
  description = "A pre-modernization Vault release stored in artifactory.hashicorp.engineering to install during rollback. Mutually exclusive with rollback_artifact_path and rollback_release."
  default     = null
}

variable "rollback_artifact_path" {
  type        = string
  description = "The path to a locally held pre-modernization vault artifact (e.g. a pinned vault.zip retained from before the modernization deploy) to install during rollback. Mutually exclusive with rollback_artifactory_release and rollback_release."
  default     = null
}

variable "rollback_release" {
  type = object({
    edition = string
    version = string
  })
  description = "A pinned public pre-modernization Vault release to install during rollback, e.g. { edition = \"ce\", version = \"1.16.31\" } (the \"product\" attribute is added automatically). This is the option enos/enos-scenario-rollback-validation.hcl uses so that rollback never depends on a mutable \"latest\" artifact. Mutually exclusive with rollback_artifactory_release and rollback_artifact_path."
  default     = null
}

variable "vault_install_dir" {
  type        = string
  description = "The directory where the Vault binary will be installed"
}

variable "vault_root_token" {
  type        = string
  description = "The vault root token"
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

locals {
  vault_bin_path = "${var.vault_install_dir}/vault"
}

// Reinstall the pinned pre-modernization Vault artifact in-place. Per ../vault_upgrade, zip
// bundles must be installed at the same path as the original installation so the existing
// systemd unit (created by enos_vault_start) keeps pointing at the right binary.
resource "enos_bundle_install" "rollback_vault_binary" {
  for_each = var.hosts

  destination = var.vault_install_dir
  artifactory = var.rollback_artifactory_release
  path        = var.rollback_artifact_path
  release     = var.rollback_release == null ? null : merge({ product = "vault" }, var.rollback_release)

  transport = {
    ssh = {
      host = each.value.public_ip
    }
  }
}

// Same rationale as ../vault_upgrade/scripts/maybe-remove-old-unit-file.sh, reversed direction:
// if the modernization deploy installed a package (with its own systemd unit) and we're rolling
// back to a zip bundle, drop the package's unit file so the reused vault.service unit (still
// pointing at var.vault_install_dir) takes effect again.
resource "enos_remote_exec" "maybe_remove_old_unit_file" {
  for_each   = var.hosts
  depends_on = [enos_bundle_install.rollback_vault_binary]

  environment = {
    ARTIFACT_NAME = enos_bundle_install.rollback_vault_binary[each.key].name
  }

  scripts = [abspath("${path.module}/scripts/maybe-remove-old-unit-file.sh")]

  transport = {
    ssh = {
      host = each.value.public_ip
    }
  }
}

module "get_ip_addresses" {
  source = "../vault_get_cluster_ips"

  depends_on = [enos_remote_exec.maybe_remove_old_unit_file]

  hosts             = var.hosts
  ip_version        = var.ip_version
  vault_addr        = var.vault_addr
  vault_install_dir = var.vault_install_dir
  vault_root_token  = var.vault_root_token
}

// Restart followers first: Raft keeps serving reads/writes through the remaining quorum, and
// every follower proves the pre-modernization binary can start, rejoin Raft, and unseal before
// the leader is touched.
module "restart_followers" {
  source            = "../restart_vault"
  hosts             = module.get_ip_addresses.follower_hosts
  vault_addr        = var.vault_addr
  vault_install_dir = var.vault_install_dir
}

resource "enos_vault_unseal" "followers" {
  for_each = {
    for idx, host in module.get_ip_addresses.follower_hosts : idx => host
    if var.vault_seal_type == "shamir"
  }
  depends_on = [module.restart_followers]

  bin_path    = local.vault_bin_path
  vault_addr  = var.vault_addr
  seal_type   = var.vault_seal_type
  unseal_keys = var.vault_unseal_keys

  transport = {
    ssh = {
      host = each.value.public_ip
    }
  }
}

module "wait_for_followers_unsealed" {
  source = "../vault_wait_for_cluster_unsealed"
  depends_on = [
    module.restart_followers,
    enos_vault_unseal.followers,
  ]

  hosts             = module.get_ip_addresses.follower_hosts
  vault_addr        = var.vault_addr
  vault_install_dir = var.vault_install_dir
}

// Restart the leader last, once every follower has already come back up successfully on the
// pre-modernization binary.
module "restart_leader" {
  depends_on        = [module.wait_for_followers_unsealed]
  source            = "../restart_vault"
  hosts             = module.get_ip_addresses.leader_hosts
  vault_addr        = var.vault_addr
  vault_install_dir = var.vault_install_dir
}

resource "enos_vault_unseal" "leader" {
  count      = var.vault_seal_type == "shamir" ? 1 : 0
  depends_on = [module.restart_leader]

  bin_path    = local.vault_bin_path
  vault_addr  = var.vault_addr
  seal_type   = var.vault_seal_type
  unseal_keys = var.vault_unseal_keys

  transport = {
    ssh = {
      host = module.get_ip_addresses.leader_public_ip
    }
  }
}
