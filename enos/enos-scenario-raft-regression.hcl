# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

scenario "raft_regression" {
  description = <<-EOF
    The raft_regression scenario validates that Raft cluster failover, leader election, and
    replication health show zero degradation after the handler registry migration (WO-024) and
    the autoSeal->CoreAccess refactor (WO-015). It provisions a 5 node Raft cluster, performs an
    intentional leader step-down to measure election time, then performs a one-node-at-a-time
    binary-swap rolling restart (the same deployment pattern used to ship modernization changes to
    a Kubernetes StatefulSet) and asserts that:

      - no unplanned leader elections occur while restarting non-leader nodes (WO-038 AC1),
      - the leader election that follows an intentional step-down completes within 30 seconds
        (WO-038 AC2),
      - all 5 Raft voters are present after the rolling restart completes (WO-038 AC3),
      - every follower unseals successfully after being restarted (WO-038 AC4),
      - a node that is explicitly removed from the Raft configuration reports the expected removed
        status after the rolling restart (WO-038 AC5, the "530 removed" half; the "474 partition"
        half is validated by TestSysHealth_Raft/partition in vault/external_tests/raft/raft_test.go
        -- this repo's enos/modules/ has no existing network-fault-injection primitive (no
        iptables/security-group module), so a true network partition of a live EC2 node is out of
        scope for this scenario; see the WO-038 completion comment for details).

    # How to run this scenario

    For general instructions on running a scenario, refer to the Enos docs: https://eng-handbook.hashicorp.services/internal-tools/enos/running-a-scenario/

    Variables required for all scenario variants:
      - aws_ssh_private_key_path
      - aws_ssh_keypair_name
      - vault_artifact_path (path to a locally built vault.zip, when using artifact_source:local)
      - vault_product_version
      - vault_revision
  EOF

  matrix {
    arch            = ["amd64"]
    artifact_source = global.artifact_sources
    artifact_type   = ["bundle"]
    distro          = ["ubuntu"]
    edition         = ["ce"]
    ip_version      = ["4"]
    seal            = global.seals

    # PKCS#11 can only be used on ent.hsm editions, which this CE-only scenario never selects.
    exclude {
      seal = ["pkcs11"]
    }
  }

  terraform_cli = terraform_cli.default
  terraform     = terraform.default
  providers = [
    provider.aws.default,
    provider.enos.ubuntu,
  ]

  locals {
    artifact_path      = matrix.artifact_source != "artifactory" ? abspath(var.vault_artifact_path) : null
    vault_install_dir  = global.vault_install_dir[matrix.artifact_type]
    node_count         = 5
    restart_delay_secs = 10

    # Aggressive autopilot intervals (per WO-038 technical_details) so the cluster converges fast
    # enough to fit the 15 minute CI time budget without masking real timing issues.
    raft_addl_config = {
      autopilot_reconcile_interval = "5s"
      autopilot_update_interval    = "2s"
    }
  }

  step "build_vault" {
    description = global.description.build_vault
    module      = "build_${matrix.artifact_source}"

    variables {
      build_tags      = var.vault_local_build_tags != null ? var.vault_local_build_tags : global.build_tags[matrix.edition]
      artifact_path   = local.artifact_path
      goarch          = matrix.arch
      goos            = "linux"
      product_version = var.vault_product_version
      artifact_type   = matrix.artifact_type
      revision        = var.vault_revision
    }
  }

  step "ec2_info" {
    description = global.description.ec2_info
    module      = module.ec2_info
  }

  step "create_vpc" {
    description = global.description.create_vpc
    module      = module.create_vpc

    variables {
      common_tags = global.tags
      ip_version  = matrix.ip_version
    }
  }

  step "create_seal_key" {
    description = global.description.create_seal_key
    module      = "seal_${matrix.seal}"
    depends_on  = [step.create_vpc]

    providers = {
      enos = provider.enos.ubuntu
    }

    variables {
      cluster_id  = step.create_vpc.id
      common_tags = global.tags
    }
  }

  step "create_vault_cluster_targets" {
    description = global.description.create_vault_cluster_targets
    module      = module.target_ec2_instances
    depends_on  = [step.create_vpc]

    providers = {
      enos = provider.enos.ubuntu
    }

    variables {
      ami_id          = step.ec2_info.ami_ids[matrix.arch][matrix.distro][global.distro_version[matrix.distro]]
      cluster_tag_key = global.vault_tag_key
      common_tags     = global.tags
      instance_count  = local.node_count
      seal_key_names  = step.create_seal_key.resource_names
      vpc_id          = step.create_vpc.id
    }
  }

  step "create_vault_cluster" {
    description = "${global.description.create_vault_cluster} 5 nodes, integrated Raft storage."
    module      = module.vault_cluster
    depends_on = [
      step.build_vault,
      step.create_vault_cluster_targets,
    ]

    providers = {
      enos = provider.enos.ubuntu
    }

    verifies = [
      quality.vault_api_sys_storage_raft_configuration_read,
      quality.vault_init,
      quality.vault_storage_backend_raft,
      quality.vault_unseal_ha_leader_election,
    ]

    variables {
      cluster_name                = step.create_vault_cluster_targets.cluster_name
      config_mode                 = "file"
      enable_audit_devices        = var.vault_enable_audit_devices
      hosts                       = step.create_vault_cluster_targets.hosts
      install_dir                 = local.vault_install_dir
      ip_version                  = matrix.ip_version
      packages                    = concat(global.packages, global.distro_packages[matrix.distro][global.distro_version[matrix.distro]])
      release = {
        edition = matrix.edition
        version = var.vault_product_version
      }
      seal_attributes              = step.create_seal_key.attributes
      seal_type                   = matrix.seal
      storage_backend              = "raft"
      storage_backend_addl_config = local.raft_addl_config
    }
  }

  step "wait_for_leader" {
    description = global.description.wait_for_cluster_to_have_leader
    module      = module.vault_wait_for_leader
    depends_on  = [step.create_vault_cluster]

    providers = {
      enos = provider.enos.ubuntu
    }

    verifies = [
      quality.vault_api_sys_leader_read,
      quality.vault_unseal_ha_leader_election,
    ]

    variables {
      hosts             = step.create_vault_cluster_targets.hosts
      ip_version        = matrix.ip_version
      timeout           = 120
      vault_addr        = step.create_vault_cluster.api_addr_localhost
      vault_install_dir = local.vault_install_dir
      vault_root_token  = step.create_vault_cluster.root_token
    }
  }

  step "get_vault_cluster_ips" {
    description = global.description.get_vault_cluster_ip_addresses
    module      = module.vault_get_cluster_ips
    depends_on = [
      step.create_vault_cluster,
      step.wait_for_leader,
    ]

    providers = {
      enos = provider.enos.ubuntu
    }

    verifies = [
      quality.vault_api_sys_ha_status_read,
      quality.vault_api_sys_leader_read,
    ]

    variables {
      hosts             = step.create_vault_cluster.hosts
      ip_version        = matrix.ip_version
      vault_addr        = step.create_vault_cluster.api_addr_localhost
      vault_install_dir = local.vault_install_dir
      vault_root_token  = step.create_vault_cluster.root_token
    }
  }

  step "verify_raft_voters_before_restart" {
    description = "Verify all 5 nodes are Raft voters before we start the rolling restart"
    module      = module.vault_verify_raft_auto_join_voter
    depends_on = [
      step.create_vault_cluster,
      step.get_vault_cluster_ips,
    ]

    providers = {
      enos = provider.enos.ubuntu
    }

    verifies = quality.vault_raft_voters

    variables {
      hosts                   = step.create_vault_cluster.hosts
      ip_version               = matrix.ip_version
      vault_addr               = step.create_vault_cluster.api_addr_localhost
      vault_cluster_addr_port  = step.create_vault_cluster.cluster_port
      vault_install_dir        = local.vault_install_dir
      vault_root_token         = step.create_vault_cluster.root_token
    }
  }

  # WO-038 AC2: intentional leader step-down, then assert election completes within 30s.
  step "step_down_leader" {
    description = "Intentionally step down the current leader (POST /v1/sys/step-down)"
    module      = module.vault_step_down
    depends_on  = [step.verify_raft_voters_before_restart]

    providers = {
      enos = provider.enos.ubuntu
    }

    variables {
      leader_host       = step.get_vault_cluster_ips.leader_host
      vault_addr        = step.create_vault_cluster.api_addr_localhost
      vault_install_dir = local.vault_install_dir
      vault_root_token  = step.create_vault_cluster.root_token
    }
  }

  step "wait_for_new_leader_after_step_down" {
    description = "WO-038 AC2: assert a new leader is elected within 30s of the step-down"
    module      = module.vault_wait_for_leader
    depends_on  = [step.step_down_leader]

    providers = {
      enos = provider.enos.ubuntu
    }

    verifies = [
      quality.vault_api_sys_leader_read,
      quality.vault_unseal_ha_leader_election,
    ]

    variables {
      hosts             = step.create_vault_cluster_targets.hosts
      ip_version        = matrix.ip_version
      timeout           = 30
      vault_addr        = step.create_vault_cluster.api_addr_localhost
      vault_install_dir = local.vault_install_dir
      vault_root_token  = step.create_vault_cluster.root_token
    }
  }

  step "get_vault_cluster_ips_after_step_down" {
    description = global.description.get_vault_cluster_ip_addresses
    module      = module.vault_get_cluster_ips
    depends_on  = [step.wait_for_new_leader_after_step_down]

    providers = {
      enos = provider.enos.ubuntu
    }

    variables {
      hosts             = step.create_vault_cluster.hosts
      ip_version        = matrix.ip_version
      vault_addr        = step.create_vault_cluster.api_addr_localhost
      vault_install_dir = local.vault_install_dir
      vault_root_token  = step.create_vault_cluster.root_token
    }
  }

  # WO-038 AC1 + AC4: one-node-at-a-time binary-swap rolling restart of all 5 nodes. Each node
  # asserts (via enos/modules/vault_rolling_restart/scripts/rolling-restart-node.sh) that
  # restarting it did not cause an unplanned leader election, and re-unseals itself before the
  # module moves on to the next node.
  step "rolling_restart" {
    description = "Binary-swap rolling restart of all 5 nodes, one at a time, simulating the modernization deployment pattern"
    module      = module.vault_rolling_restart
    depends_on  = [step.get_vault_cluster_ips_after_step_down]

    providers = {
      enos = provider.enos.ubuntu
    }

    verifies = [
      quality.vault_raft_modernization_no_unplanned_elections,
      quality.vault_service_restart,
    ]

    variables {
      hosts                 = values(step.create_vault_cluster_targets.hosts)
      restart_delay_seconds = local.restart_delay_secs
      vault_addr            = step.create_vault_cluster.api_addr_localhost
      vault_install_dir     = local.vault_install_dir
      vault_seal_type       = matrix.seal
      vault_unseal_keys     = matrix.seal == "shamir" ? step.create_vault_cluster.unseal_keys_hex : null
    }
  }

  step "wait_for_followers_unsealed_after_restart" {
    description = "WO-038 AC4: follower unsealing succeeds after the rolling restart (EnsureCoreUnsealed pattern)"
    module      = module.vault_wait_for_cluster_unsealed
    depends_on  = [step.rolling_restart]

    providers = {
      enos = provider.enos.ubuntu
    }

    variables {
      hosts             = step.create_vault_cluster_targets.hosts
      vault_addr        = step.create_vault_cluster.api_addr_localhost
      vault_install_dir = local.vault_install_dir
    }
  }

  step "verify_raft_voters_after_restart" {
    description = "WO-038 AC3: assert all 5 Raft voters are present after the rolling restart"
    module      = module.vault_verify_raft_auto_join_voter
    depends_on  = [step.wait_for_followers_unsealed_after_restart]

    providers = {
      enos = provider.enos.ubuntu
    }

    verifies = [
      quality.vault_raft_modernization_voter_stability,
      quality.vault_raft_voters,
    ]

    variables {
      hosts                   = step.create_vault_cluster.hosts
      ip_version              = matrix.ip_version
      vault_addr              = step.create_vault_cluster.api_addr_localhost
      vault_cluster_addr_port = step.create_vault_cluster.cluster_port
      vault_install_dir       = local.vault_install_dir
      vault_root_token        = step.create_vault_cluster.root_token
    }
  }

  step "get_vault_cluster_ips_after_restart" {
    description = global.description.get_vault_cluster_ip_addresses
    module      = module.vault_get_cluster_ips
    depends_on  = [step.verify_raft_voters_after_restart]

    providers = {
      enos = provider.enos.ubuntu
    }

    variables {
      hosts             = step.create_vault_cluster.hosts
      ip_version        = matrix.ip_version
      vault_addr        = step.create_vault_cluster.api_addr_localhost
      vault_install_dir = local.vault_install_dir
      vault_root_token  = step.create_vault_cluster.root_token
    }
  }

  # WO-038 AC5 (the "530 removed" half -- see scenario description for the "474 partition" half).
  step "remove_a_follower_peer" {
    description = "Remove a follower from the Raft configuration and verify it reports the removed status (HTTP 530)"
    module      = module.vault_raft_remove_peer
    depends_on  = [step.get_vault_cluster_ips_after_restart]

    providers = {
      enos = provider.enos.ubuntu
    }

    verifies = [
      quality.vault_api_sys_storage_raft_remove_peer_write_removes_peer,
    ]

    variables {
      hosts                   = step.create_vault_cluster.hosts
      ip_version              = matrix.ip_version
      operator_instance       = step.get_vault_cluster_ips_after_restart.leader_public_ip
      vault_addr              = step.create_vault_cluster.api_addr_localhost
      vault_cluster_addr_port = step.create_vault_cluster.cluster_port
      vault_install_dir       = local.vault_install_dir
      vault_root_token        = step.create_vault_cluster.root_token
    }
  }

  step "verify_removed_peer_reports_removed_status" {
    description = "Verify the removed node continues reporting HTTP 530 (removed) after the rolling restart"
    module      = "vault_verify_removed_node"
    depends_on  = [step.remove_a_follower_peer]

    providers = {
      enos = provider.enos.ubuntu
    }

    verifies = [
      quality.vault_raft_removed_after_restart,
      quality.vault_raft_removed_statuses,
    ]

    variables {
      add_back_nodes    = false
      cluster_port      = step.create_vault_cluster.cluster_port
      hosts             = step.create_vault_cluster.hosts
      ip_version        = matrix.ip_version
      listener_port     = step.create_vault_cluster.listener_port
      vault_addr        = step.create_vault_cluster.api_addr_localhost
      vault_install_dir = local.vault_install_dir
      vault_leader_host = step.get_vault_cluster_ips_after_restart.leader_host
      vault_root_token  = step.create_vault_cluster.root_token
      vault_seal_type   = matrix.seal
      vault_unseal_keys = matrix.seal == "shamir" ? step.create_vault_cluster.unseal_keys_hex : null
    }
  }

  output "cluster_name" {
    description = "The Vault cluster name"
    value       = step.create_vault_cluster.cluster_name
  }

  output "hosts" {
    description = "The Vault cluster target hosts"
    value       = step.create_vault_cluster.hosts
  }

  output "root_token" {
    description = "The Vault cluster root token"
    value       = step.create_vault_cluster.root_token
  }

  output "unseal_keys_hex" {
    description = "The Vault cluster unseal keys hex"
    value       = step.create_vault_cluster.unseal_keys_hex
  }
}
