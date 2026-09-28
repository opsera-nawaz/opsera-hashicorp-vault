# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

# verify_fips_node_scheduling is the WO-059 quality gate for
# FIPS-CONTAINER-001: it confirms that every Vault pod handed to it (the
# ce.fips edition's pods) is actually running on a Kubernetes node carrying
# var.fips_node_selector, i.e. that the node affinity/selector/toleration
# configuration wired into module.k8s_deploy_vault (see
# enos/modules/k8s_deploy_vault) was honored by the scheduler and not just
# accepted as Helm chart values. A FIPS-capable container image (WO-046) on
# a non-FIPS host is not a FIPS-compliant deployment, so this checks the
# real cluster state via kubectl rather than trusting the Helm values.

terraform {
  required_providers {
    enos = {
      source = "registry.terraform.io/hashicorp-forge/enos"
    }
  }
}

resource "enos_local_exec" "verify_fips_node_scheduling" {
  for_each = { for pod in var.vault_pods : pod.name => pod }

  environment = {
    KUBECONFIG_BASE64  = var.kubeconfig_base64
    CONTEXT_NAME       = var.context_name
    POD_NAME           = each.value.name
    NAMESPACE          = each.value.namespace
    NODE_SELECTOR_JSON = jsonencode(var.fips_node_selector)
  }

  scripts = [abspath("${path.module}/scripts/verify-fips-node-scheduling.sh")]
}

output "stdout" {
  value       = { for name, res in enos_local_exec.verify_fips_node_scheduling : name => res.stdout }
  description = "Per-pod PASS output of the FIPS node scheduling verification (fails the apply on any FAIL)"
}
