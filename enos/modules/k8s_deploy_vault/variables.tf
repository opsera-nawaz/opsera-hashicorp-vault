# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

variable "context_name" {
  type        = string
  description = "The name of the k8s context for Vault"
}

variable "ent_license" {
  type        = string
  description = "The value of a valid Vault Enterprise license"
}

variable "image_repository" {
  type        = string
  description = "The name of the Vault repository, ie hashicorp/vault or hashicorp/vault-enterprise for the image to deploy"
}

variable "image_tag" {
  type        = string
  description = "The tag of the vault image to deploy"
}

variable "kubeconfig_base64" {
  type        = string
  description = "The base64 encoded version of the Kubernetes configuration file"
}

variable "vault_edition" {
  type        = string
  description = "The Vault product edition"
}

variable "vault_instance_count" {
  type        = number
  description = "How many vault instances are in the cluster"
}

variable "vault_log_level" {
  description = "The server log level for Vault logs. Supported values (in order of detail) are trace, debug, info, warn, and err."
  type        = string
}

# WO-052 AC3: Kubernetes/Helm rollback validation. Disabled by default so existing callers (e.g.
# enos/k8s/enos-scenario-k8s.hcl) are unaffected.
variable "enable_rollback_test" {
  type        = bool
  description = "If true, after the base deployment is healthy: write a test secret, helm upgrade to rollback_test_image_tag, then helm rollback back to the original release, asserting pod readiness, GET /v1/sys/health, and secret integrity, all within rollback_test_sla_seconds"
  default     = false
}

variable "rollback_test_image_tag" {
  type        = string
  description = "The image tag to helm-upgrade to before exercising the WO-052 rollback test. Defaults to var.image_tag (a same-content revision bump) when unset."
  default     = null
}

variable "rollback_test_sla_seconds" {
  type        = number
  description = "WO-052 AC6: the rollback recovery SLA, in seconds, enforced by the rollback test"
  default     = 1800
}
