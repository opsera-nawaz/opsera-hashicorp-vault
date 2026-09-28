# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

variable "container_image_archive" {
  description = "The path to the location of the container image archive to test"
  type        = string
  default     = null # If none is given we'll simply load a container from a repo
}

variable "log_level" {
  description = "The server log level for Vault logs. Supported values (in order of detail) are trace, debug, info, warn, and err."
  type        = string
  default     = "trace"
}

variable "instance_count" {
  description = "How many instances to create for the Vault cluster"
  type        = number
  default     = 3
}

variable "terraform_plugin_cache_dir" {
  description = "The directory to cache Terraform modules and providers"
  type        = string
  default     = null
}

variable "vault_build_date" {
  description = "The expected vault build date"
  type        = string
  default     = ""
}

variable "vault_revision" {
  type        = string
  description = "The expected vault revision"
  default     = "ce"
}

variable "vault_version" {
  description = "The expected vault version"
  type        = string
  default     = "1.18.0"
}

# WO-059 FIPS-CONTAINER-001: a FIPS-capable container image (WO-046) is necessary but not
# sufficient -- it must also be scheduled onto a host that is actually running in FIPS mode. These
# three variables let the ce.fips scenario variant constrain scheduling accordingly; they default
# to disabled/empty so every existing edition (ce, ent, ent.fips1403, ent.hsm, ent.hsm.fips1403) is
# unaffected.
variable "vault_fips_node_selector" {
  description = "Node selector for FIPS-path Vault pods"
  type        = map(string)
  default = {
    "vault.hashicorp.com/fips" = "true"
  }
}

variable "vault_fips_node_affinity_enabled" {
  description = "Enable FIPS node affinity scheduling"
  type        = bool
  default     = false
}

variable "vault_fips_tolerations" {
  description = "Tolerations for FIPS-tainted nodes"
  type = list(object({
    key      = string
    operator = string
    value    = string
    effect   = string
  }))
  default = []
}
