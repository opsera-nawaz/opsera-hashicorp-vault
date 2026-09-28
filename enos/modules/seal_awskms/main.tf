# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

terraform {
  required_providers {
    enos = {
      source = "registry.terraform.io/hashicorp-forge/enos"
    }
  }
}

variable "cluster_id" {
  type = string
}

variable "cluster_meta" {
  type    = string
  default = null
}

variable "cluster_ssh_keypair" {
  type    = string
  default = null
}

variable "common_tags" {
  type    = map(string)
  default = null
}

variable "other_resources" {
  type    = list(string)
  default = []
}

variable "edition" {
  type        = string
  description = "The Vault edition under test (e.g. ce, ce.fips, ent.fips1403). Used only to require a FIPS KMS endpoint when the edition is a FIPS edition; it has no effect on the key created."
  default     = "ce"
}

variable "kms_endpoint" {
  type        = string
  description = "Optional AWS KMS endpoint override. When set, it should be a region-specific FIPS endpoint (e.g. kms-fips.us-east-1.amazonaws.com) so that Vault's awskms seal uses the CMVP-validated FIPS KMS endpoint for auto-unseal instead of the standard regional endpoint. Required (non-empty) when var.edition contains \"fips\"."
  default     = ""

  validation {
    condition     = var.kms_endpoint == "" || can(regex("^kms(-fips)?\\.[a-z0-9-]+\\.amazonaws\\.com$", var.kms_endpoint))
    error_message = "kms_endpoint, when set, must be a valid regional AWS KMS endpoint hostname, e.g. kms-fips.us-east-1.amazonaws.com."
  }
}

locals {
  cluster_name = var.cluster_meta == null ? var.cluster_id : "${var.cluster_id}-${var.cluster_meta}"
}

# Cross-variable enforcement of "kms_endpoint is required for FIPS
# editions" via an output precondition rather than a variable validation
# block referencing another variable: this module's required_version
# (enos/enos-terraform.hcl, >= 1.2.0) predates Terraform 1.9, which is
# when cross-variable references inside `variable` validation blocks
# became supported. Output preconditions have been supported since
# Terraform 1.2.
output "_require_fips_kms_endpoint" {
  description = "Internal guard (not a consumable value): fails plan/apply when var.edition is a FIPS edition and var.kms_endpoint was left at its empty default."
  value       = null

  precondition {
    condition     = !strcontains(var.edition, "fips") || var.kms_endpoint != ""
    error_message = "seal_awskms: var.kms_endpoint must be set to a region-specific FIPS KMS endpoint (e.g. kms-fips.us-east-1.amazonaws.com) whenever var.edition contains \"fips\"."
  }
}

resource "aws_kms_key" "key" {
  description             = "auto-unseal-key-${local.cluster_name}"
  deletion_window_in_days = 7 // 7 is the shortest allowed window
  tags                    = var.common_tags

  timeouts {
    create = "10m"
  }
}

resource "aws_kms_alias" "alias" {
  name          = "alias/auto-unseal-key-${local.cluster_name}"
  target_key_id = aws_kms_key.key.key_id
}

output "attributes" {
  description = "Seal device specific attributes"
  value = merge(
    { kms_key_id = aws_kms_key.key.arn },
    var.kms_endpoint != "" ? { endpoint = var.kms_endpoint } : {}
  )
}

// We output our resource name and a collection of those passed in to create a full list of key
// resources that might be required for instance roles that are associated with some unseal types.
output "resource_name" {
  description = "The awskms key name"
  value       = aws_kms_key.key.arn
}

output "resource_names" {
  description = "The list of awskms key names to associate with a role"
  value       = compact(concat([aws_kms_key.key.arn], var.other_resources))
}
