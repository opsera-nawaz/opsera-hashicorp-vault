# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

terraform {
  required_version = ">= 1.0"

  required_providers {
    enos = {
      source = "registry.terraform.io/hashicorp-forge/enos"
    }

    helm = {
      source  = "hashicorp/helm"
      version = "3.1.1"
    }
  }
}

locals {
  chart_settings = {
    "server.affinity"                                                       = ""
    "server.dataStorage.size"                                               = "100m"
    "server.ha.enabled"                                                     = "true"
    "server.ha.raft.config"                                                 = file("${abspath(path.module)}/raft-config.hcl")
    "server.ha.raft.enabled"                                                = "true"
    "server.ha.replicas"                                                    = var.vault_instance_count
    "server.image.pullPolicy"                                               = "Never" # Forces local image use
    "server.image.repository"                                               = var.image_repository
    "server.image.tag"                                                      = var.image_tag
    "server.limits.cpu"                                                     = "200m"
    "server.limits.memory"                                                  = "200m"
    "server.logLevel"                                                       = var.vault_log_level
    "server.resources.requests.cpu"                                         = "50m"
    "server.statefulSet.securityContext.container.allowPrivilegeEscalation" = "false"
    "server.statefulSet.securityContext.pod.runAsNonRoot"                   = "true"
    "server.statefulSet.securityContext.pod.runAsGroup"                     = "1000"
    "server.statefulSet.securityContext.pod.runAsUser"                      = "100"
    "server.statefulSet.securityContext.pod.fsGroup"                        = "1000"
  }
  all_chart_settings = var.ent_license == null ? local.chart_settings : merge(local.chart_settings, {
    "server.extraEnvironmentVars.VAULT_LICENSE" = var.ent_license
  })
  chart_list_settings = {
    "server.statefulSet.securityContext.container.capabilities.add" = [
      "IPC_LOCK",
    ],
  }

  vault_address = "http://127.0.0.1:8200"

  instance_indexes = [for idx in range(var.vault_instance_count) : tostring(idx)]

  leader_idx    = local.instance_indexes[0]
  followers_idx = toset(slice(local.instance_indexes, 1, var.vault_instance_count))
}

resource "helm_release" "vault" {
  name = "vault"

  repository = "https://helm.releases.hashicorp.com"
  chart      = "vault"

  set      = [for k, v in local.all_chart_settings : { name : k, value : v }]
  set_list = [for k, v in local.chart_list_settings : { name : k, value : v }]
}

data "enos_kubernetes_pods" "vault_pods" {
  kubeconfig_base64 = var.kubeconfig_base64
  context_name      = var.context_name
  namespace         = helm_release.vault.namespace
  label_selectors = [
    "app.kubernetes.io/name=vault",
    "component=server"
  ]

  depends_on = [helm_release.vault]
}

resource "enos_vault_init" "leader" {
  bin_path   = "/bin/vault"
  vault_addr = local.vault_address

  key_shares    = 5
  key_threshold = 3

  transport = {
    kubernetes = {
      kubeconfig_base64 = var.kubeconfig_base64
      context_name      = var.context_name
      pod               = data.enos_kubernetes_pods.vault_pods.pods[local.leader_idx].name
      namespace         = data.enos_kubernetes_pods.vault_pods.pods[local.leader_idx].namespace
    }
  }
}

resource "enos_vault_unseal" "leader" {
  bin_path    = "/bin/vault"
  vault_addr  = local.vault_address
  seal_type   = "shamir"
  unseal_keys = enos_vault_init.leader.unseal_keys_b64

  transport = {
    kubernetes = {
      kubeconfig_base64 = var.kubeconfig_base64
      context_name      = var.context_name
      pod               = data.enos_kubernetes_pods.vault_pods.pods[local.leader_idx].name
      namespace         = data.enos_kubernetes_pods.vault_pods.pods[local.leader_idx].namespace
    }
  }

  depends_on = [enos_vault_init.leader]
}

// We need to manually join the followers since the join request must only happen after the leader
// has been initialized. We could use retry join, but in that case we'd need to restart the follower
// pods once the leader is setup. The default helm deployment configuration for an HA cluster as
// documented here: https://learn.hashicorp.com/tutorials/vault/kubernetes-raft-deployment-guide#configure-vault-helm-chart
// uses a liveness probe that automatically restarts nodes that are not healthy. This works well for
// clusters that are configured with auto-unseal as eventually the nodes would join and unseal.
resource "enos_remote_exec" "raft_join" {
  for_each = local.followers_idx

  inline = [
    // asserts that vault is ready
    "for i in 1 2 3 4 5; do vault status > /dev/null 2>&1 && break || sleep 5; done",
    // joins the follower to the leader
    "vault operator raft join http://vault-0.vault-internal:8200"
  ]

  transport = {
    kubernetes = {
      kubeconfig_base64 = var.kubeconfig_base64
      context_name      = var.context_name
      pod               = data.enos_kubernetes_pods.vault_pods.pods[each.key].name
      namespace         = data.enos_kubernetes_pods.vault_pods.pods[each.key].namespace
    }
  }

  depends_on = [enos_vault_unseal.leader]
}


resource "enos_vault_unseal" "followers" {
  for_each = local.followers_idx

  bin_path    = "/bin/vault"
  vault_addr  = local.vault_address
  seal_type   = "shamir"
  unseal_keys = enos_vault_init.leader.unseal_keys_b64

  transport = {
    kubernetes = {
      kubeconfig_base64 = var.kubeconfig_base64
      context_name      = var.context_name
      pod               = data.enos_kubernetes_pods.vault_pods.pods[each.key].name
      namespace         = data.enos_kubernetes_pods.vault_pods.pods[each.key].namespace
    }
  }

  depends_on = [enos_remote_exec.raft_join]
}

output "vault_root_token" {
  value = enos_vault_init.leader.root_token
}

output "vault_pods" {
  value = data.enos_kubernetes_pods.vault_pods.pods
}

# WO-052 AC3: validate the Kubernetes/Helm rollback path documented in
# docs/rollback-procedures.md, "Method 2: Kubernetes/Helm rollback". `helm upgrade` and
# `helm rollback` are imperative CLI operations that the declarative helm_release resource above
# cannot express, so this runs the real `helm` and `kubectl` binaries via enos_local_exec against
# the release already provisioned above. Every resource here is gated on var.enable_rollback_test
# so existing callers of this module are unaffected.
locals {
  rollback_test_image_tag = coalesce(var.rollback_test_image_tag, var.image_tag)
}

# Write the WO-052 data-integrity fixture before the rollback test's helm upgrade, so we can
# later confirm rollback preserved it. Uses a dedicated "rollback-test" KV v2 mount so it can
# never collide with the "secret" KV v1 mount that k8s_vault_verify_write_data manages.
resource "enos_local_exec" "rollback_test_write_secret" {
  count      = var.enable_rollback_test ? 1 : 0
  depends_on = [enos_vault_unseal.followers, enos_vault_unseal.leader]

  environment = {
    KUBECONFIG_BASE64 = var.kubeconfig_base64
    CONTEXT_NAME      = var.context_name
    NAMESPACE         = helm_release.vault.namespace
    POD_NAME          = data.enos_kubernetes_pods.vault_pods.pods[local.leader_idx].name
    VAULT_ROOT_TOKEN  = enos_vault_init.leader.root_token
  }

  scripts = [abspath("${path.module}/scripts/rollback-test-write-secret.sh")]
}

# WO-052 AC6: the 30 minute SLA clock starts here, immediately before the helm upgrade that the
# rollback will reverse.
resource "enos_local_exec" "rollback_test_mark_start" {
  count      = var.enable_rollback_test ? 1 : 0
  depends_on = [enos_local_exec.rollback_test_write_secret]

  scripts = [abspath("${path.module}/scripts/rollback-test-mark-epoch.sh")]
}

resource "enos_local_exec" "rollback_test_helm_upgrade" {
  count      = var.enable_rollback_test ? 1 : 0
  depends_on = [enos_local_exec.rollback_test_mark_start]

  environment = {
    KUBECONFIG_BASE64 = var.kubeconfig_base64
    CONTEXT_NAME      = var.context_name
    RELEASE_NAME      = helm_release.vault.name
    NAMESPACE         = helm_release.vault.namespace
    IMAGE_REPOSITORY  = var.image_repository
    IMAGE_TAG         = local.rollback_test_image_tag
  }

  scripts = [abspath("${path.module}/scripts/rollback-test-helm-upgrade.sh")]
}

# Executes the actual rollback procedure (helm rollback <release> 1) and asserts pod readiness
# plus GET /v1/sys/health == 200 or 429 (WO-052 AC3), handling the "release history pruned"
# edge case from WO-052's edge_cases list.
resource "enos_local_exec" "rollback_test_helm_rollback" {
  count      = var.enable_rollback_test ? 1 : 0
  depends_on = [enos_local_exec.rollback_test_helm_upgrade]

  environment = {
    KUBECONFIG_BASE64 = var.kubeconfig_base64
    CONTEXT_NAME      = var.context_name
    RELEASE_NAME      = helm_release.vault.name
    NAMESPACE         = helm_release.vault.namespace
  }

  scripts = [abspath("${path.module}/scripts/rollback-test-helm-rollback.sh")]
}

# WO-052 AC4-equivalent for the Kubernetes path: the secret written before the helm upgrade must
# still be readable, with the correct value, after helm rollback.
resource "enos_local_exec" "rollback_test_verify_secret" {
  count      = var.enable_rollback_test ? 1 : 0
  depends_on = [enos_local_exec.rollback_test_helm_rollback]

  environment = {
    KUBECONFIG_BASE64 = var.kubeconfig_base64
    CONTEXT_NAME      = var.context_name
    NAMESPACE         = helm_release.vault.namespace
    POD_NAME          = data.enos_kubernetes_pods.vault_pods.pods[local.leader_idx].name
    VAULT_ROOT_TOKEN  = enos_vault_init.leader.root_token
  }

  scripts = [abspath("${path.module}/scripts/rollback-test-verify-secret.sh")]
}

# WO-052 AC6: the SLA clock stops here, after helm rollback, pod readiness, health, and secret
# integrity have all been confirmed. Fails the apply if elapsed >= rollback_test_sla_seconds.
resource "enos_local_exec" "rollback_test_assert_sla" {
  count      = var.enable_rollback_test ? 1 : 0
  depends_on = [enos_local_exec.rollback_test_verify_secret]

  environment = {
    START_EPOCH = trimspace(enos_local_exec.rollback_test_mark_start[0].stdout)
    SLA_SECONDS = var.rollback_test_sla_seconds
  }

  scripts = [abspath("${path.module}/scripts/rollback-test-assert-sla.sh")]
}

output "rollback_test_elapsed_seconds" {
  description = "WO-052 AC6: measured Kubernetes/Helm rollback wall-clock duration, in seconds (null when enable_rollback_test is false)"
  value       = var.enable_rollback_test ? trimspace(enos_local_exec.rollback_test_assert_sla[0].stdout) : null
}
