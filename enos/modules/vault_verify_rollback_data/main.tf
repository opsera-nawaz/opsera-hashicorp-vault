# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

# vault_verify_rollback_data is the WO-052 AC4 data-integrity fixture. In "write" mode it mounts a
# KV v2 secrets engine and writes a known value to <mount_path>/data/<secret_path> -- the exact
# HTTP API shape WO-052 AC4 names (/v1/secret/data/rollback-test with the defaults below). In
# "verify" mode it reads the same path back and fails the apply (via scripts/verify-secret.sh's
# exit code) if the value is missing or does not match. enos/enos-scenario-rollback-validation.hcl
# invokes this module twice: once in "write" mode before the modernization deploy, once in
# "verify" mode after rollback completes.
terraform {
  required_providers {
    enos = {
      source = "registry.terraform.io/hashicorp-forge/enos"
    }
  }
}

variable "mode" {
  type        = string
  description = "\"write\" to create the rollback data-integrity fixture, or \"verify\" to confirm it survived a rollback"

  validation {
    condition     = contains(["write", "verify"], var.mode)
    error_message = "mode must be \"write\" or \"verify\""
  }
}

variable "leader_host" {
  type = object({
    ipv6       = string
    private_ip = string
    public_ip  = string
  })
  description = "The current Vault Raft leader host to run the vault CLI against"
}

variable "vault_addr" {
  type        = string
  description = "The local vault API listen address"
}

variable "vault_install_dir" {
  type        = string
  description = "The directory where the Vault binary is installed"
}

variable "vault_root_token" {
  type        = string
  description = "The vault root token"
}

variable "mount_path" {
  type        = string
  description = "The KV v2 secrets engine mount path"
  default     = "secret"
}

variable "secret_path" {
  type        = string
  description = "The secret path under the KV v2 mount. WO-052 AC4 names secret/data/rollback-test, so the default here combines with the default mount_path to produce exactly that."
  default     = "rollback-test"
}

variable "secret_key" {
  type        = string
  description = "The field name written to the secret"
  default     = "value"
}

variable "secret_value" {
  type        = string
  description = "The field value written to the secret; verified byte-for-byte after rollback"
  default     = "wo-052-rollback-data-integrity-fixture"
}

resource "enos_remote_exec" "enable_kv_v2" {
  count = var.mode == "write" ? 1 : 0

  environment = {
    VAULT_ADDR        = var.vault_addr
    VAULT_INSTALL_DIR = var.vault_install_dir
    VAULT_TOKEN       = var.vault_root_token
    MOUNT_PATH        = var.mount_path
  }

  scripts = [abspath("${path.module}/scripts/enable-kv-v2.sh")]

  transport = {
    ssh = {
      host = var.leader_host.public_ip
    }
  }
}

resource "enos_remote_exec" "write_secret" {
  count      = var.mode == "write" ? 1 : 0
  depends_on = [enos_remote_exec.enable_kv_v2]

  environment = {
    VAULT_ADDR        = var.vault_addr
    VAULT_INSTALL_DIR = var.vault_install_dir
    VAULT_TOKEN       = var.vault_root_token
    MOUNT_PATH        = var.mount_path
    SECRET_PATH       = var.secret_path
    SECRET_KEY        = var.secret_key
    SECRET_VALUE      = var.secret_value
  }

  scripts = [abspath("${path.module}/scripts/write-secret.sh")]

  transport = {
    ssh = {
      host = var.leader_host.public_ip
    }
  }
}

resource "enos_remote_exec" "verify_secret" {
  count = var.mode == "verify" ? 1 : 0

  environment = {
    VAULT_ADDR        = var.vault_addr
    VAULT_INSTALL_DIR = var.vault_install_dir
    VAULT_TOKEN       = var.vault_root_token
    MOUNT_PATH        = var.mount_path
    SECRET_PATH       = var.secret_path
    SECRET_KEY        = var.secret_key
    SECRET_VALUE      = var.secret_value
  }

  scripts = [abspath("${path.module}/scripts/verify-secret.sh")]

  transport = {
    ssh = {
      host = var.leader_host.public_ip
    }
  }
}
