# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

variable "vault_pods" {
  type = list(object({
    name      = string
    namespace = string
  }))
  description = "The vault instances for the cluster to verify"
}

variable "kubeconfig_base64" {
  type        = string
  description = "The base64 encoded version of the Kubernetes configuration file"
}

variable "context_name" {
  type        = string
  description = "The name of the k8s context for Vault"
}

variable "fips_node_selector" {
  type        = map(string)
  description = "The node label key/value pairs that identify a FIPS-enabled Kubernetes node. Every pod in var.vault_pods must be scheduled on a node carrying all of these labels"
}
