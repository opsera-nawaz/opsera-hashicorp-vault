# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

scenario "rollback_validation" {
  description = <<-EOF
    The rollback_validation scenario validates the WO-052 rollback runbook
    (docs/rollback-procedures.md), "Method 1: Terraform/Enos binary swap", end to end. It
    provisions a 3 node Raft cluster on the pinned pre-modernization release
    (var.vault_upgrade_initial_version), writes a data-integrity test secret, performs an
    in-place upgrade to the modernized candidate build (the same enos/modules/vault_upgrade
    module the "upgrade" scenario uses), confirms the upgraded cluster is healthy, then executes
    the reverse operation -- enos/modules/vault_rollback, which reinstalls the same pinned
    pre-modernization release -- and asserts:

      - the test secret written before the upgrade is still readable, with the correct value,
        at secret/data/rollback-test after rollback (WO-052 AC4),
      - the cluster's seal state is preserved across rollback: zero manual/out-of-band unseal
        calls for auto-unseal (awskms) configurations, and a successful scripted re-unseal for
        Shamir configurations (WO-052 AC5),
      - the full rollback -- from the moment the rollback module starts until every post-rollback
        health and data-integrity check has passed -- completes in under 1800 seconds (30
        minutes), with the measured duration printed to the scenario output (WO-052 AC6).

    Vault's internal RollbackManager (vault/rollback.go) is an unrelated, application-level
    backend cleanup mechanism -- see docs/rollback-procedures.md, "A note on vault/rollback.go".
    This scenario exercises deployment rollback only.

    # How to run this scenario

    For general instructions on running a scenario, refer to the Enos docs: https://eng-handbook.hashicorp.services/internal-tools/enos/running-a-scenario/
    For troubleshooting tips and common errors, see https://eng-handbook.hashicorp.services/internal-tools/enos/troubleshooting/.

    Variables required for all scenario variants:
      - aws_ssh_private_key_path
      - aws_ssh_keypair_name
      - vault_artifact_path (path to a locally built vault.zip, when using artifact_source:local)
      - vault_product_version
      - vault_revision

    Variables required for some scenario variants:
      - vault_upgrade_initial_version (defaults to 1.16.31; this is also the pinned version
        rollback re-installs, so the scenario never depends on a mutable "latest" artifact --
        WO-052 constraint: "must use pinned artifact versions")
  EOF

  matrix {
    arch            = ["amd64"]
    artifact_source = global.artifact_sources
    artifact_type   = ["bundle"]
    distro          = ["ubuntu"]
    edition         = ["ce"]
    ip_version      = ["4"]
    seal            = global.seals

    # PKCS#11 requires an HSM this CE-only scenario doesn't provision.
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
    artifact_path        = matrix.artifact_source != "artifactory" ? abspath(var.vault_artifact_path) : null
    node_count           = 3
    rollback_sla_seconds = 1800

    # Aggressive autopilot intervals (WO-052 edge case: "rolling restart during rollback may
    # trigger autopilot to demote a node if it takes too long to rejoin") so the cluster
    # converges fast enough that a slow-but-healthy rejoin during rollback is never mistaken for
    # a dead node and evicted from the Raft configuration.
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

  # Provision the cluster on the pinned pre-modernization release -- the "pre-change state" that
  # the rollback under test must return to (WO-052 AC2).
  step "create_vault_cluster" {
    description = "${global.description.create_vault_cluster} 3 nodes, integrated Raft storage, pinned pre-modernization release."
    module      = module.vault_cluster
    depends_on  = [step.create_vault_cluster_targets]

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
      cluster_name = step.create_vault_cluster_targets.cluster_name
      config_mode  = "file"
      hosts        = step.create_vault_cluster_targets.hosts
      install_dir  = global.vault_install_dir["bundle"]
      ip_version   = matrix.ip_version
      packages     = concat(global.packages, global.distro_packages[matrix.distro][global.distro_version[matrix.distro]])
      release = {
        edition = matrix.edition
        version = var.vault_upgrade_initial_version
      }
      seal_attributes             = step.create_seal_key.attributes
      seal_type                   = matrix.seal
      storage_backend             = "raft"
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
      vault_install_dir = global.vault_install_dir["bundle"]
      vault_root_token  = step.create_vault_cluster.root_token
    }
  }

  step "get_vault_cluster_ips" {
    description = global.description.get_vault_cluster_ip_addresses
    module      = module.vault_get_cluster_ips
    depends_on  = [step.wait_for_leader]

    providers = {
      enos = provider.enos.ubuntu
    }

    variables {
      hosts             = step.create_vault_cluster.hosts
      ip_version        = matrix.ip_version
      vault_addr        = step.create_vault_cluster.api_addr_localhost
      vault_install_dir = global.vault_install_dir["bundle"]
      vault_root_token  = step.create_vault_cluster.root_token
    }
  }

  # WO-052 AC4 fixture: write the data-integrity test secret while running the pre-modernization
  # release, before anything is upgraded or rolled back.
  step "write_rollback_test_secret" {
    description = "Write the WO-052 data-integrity fixture to secret/data/rollback-test"
    module      = module.vault_verify_rollback_data
    depends_on  = [step.get_vault_cluster_ips]

    providers = {
      enos = provider.enos.ubuntu
    }

    variables {
      mode              = "write"
      leader_host       = step.get_vault_cluster_ips.leader_host
      vault_addr        = step.create_vault_cluster.api_addr_localhost
      vault_install_dir = global.vault_install_dir["bundle"]
      vault_root_token  = step.create_vault_cluster.root_token
    }
  }

  # Deploy the modernized candidate build in place, using the same module and pattern as the
  # "upgrade" scenario, so the rollback under test is reversing a real modernization deploy.
  step "deploy_modernized_binary" {
    description = "In-place upgrade to the modernized candidate build via enos/modules/vault_upgrade"
    module      = module.vault_upgrade
    depends_on  = [step.write_rollback_test_secret]

    providers = {
      enos = provider.enos.ubuntu
    }

    verifies = [
      quality.vault_cluster_upgrade_in_place,
      quality.vault_service_restart,
    ]

    variables {
      hosts                     = step.create_vault_cluster_targets.hosts
      ip_version                = matrix.ip_version
      vault_addr                = step.create_vault_cluster.api_addr_localhost
      vault_artifactory_release = matrix.artifact_source == "artifactory" ? step.build_vault.vault_artifactory_release : null
      vault_install_dir         = global.vault_install_dir[matrix.artifact_type]
      vault_local_artifact_path = local.artifact_path
      vault_root_token          = step.create_vault_cluster.root_token
      vault_seal_type           = matrix.seal
      vault_unseal_keys         = matrix.seal == "shamir" ? step.create_vault_cluster.unseal_keys_hex : null
    }
  }

  step "wait_for_leader_after_modernization" {
    description = global.description.wait_for_cluster_to_have_leader
    module      = module.vault_wait_for_leader
    depends_on  = [step.deploy_modernized_binary]

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
      vault_install_dir = global.vault_install_dir[matrix.artifact_type]
      vault_root_token  = step.create_vault_cluster.root_token
    }
  }

  step "get_vault_cluster_ips_after_modernization" {
    description = global.description.get_vault_cluster_ip_addresses
    module      = module.vault_get_cluster_ips
    depends_on  = [step.wait_for_leader_after_modernization]

    providers = {
      enos = provider.enos.ubuntu
    }

    variables {
      hosts             = step.create_vault_cluster.hosts
      ip_version        = matrix.ip_version
      vault_addr        = step.create_vault_cluster.api_addr_localhost
      vault_install_dir = global.vault_install_dir[matrix.artifact_type]
      vault_root_token  = step.create_vault_cluster.root_token
    }
  }

  # WO-052 AC6: the 30 minute SLA clock starts here -- at the "decision to rollback" point, once
  # the modernized binary is confirmed healthy and we are about to invoke the rollback procedure.
  step "mark_rollback_start" {
    description = "Record the wall-clock start time for the rollback SLA timer"
    module      = module.vault_rollback_timer
    depends_on  = [step.get_vault_cluster_ips_after_modernization]
  }

  # Execute the rollback: reinstall the pinned pre-modernization release, restarting followers
  # then the leader (WO-052 AC1/AC2, adapting enos/modules/vault_upgrade in reverse).
  step "execute_rollback" {
    description = "Roll back to the pinned pre-modernization release via enos/modules/vault_rollback"
    module      = module.vault_rollback
    depends_on  = [step.mark_rollback_start]

    providers = {
      enos = provider.enos.ubuntu
    }

    verifies = [
      quality.vault_rollback_in_place,
      quality.vault_service_restart,
    ]

    variables {
      hosts      = step.create_vault_cluster_targets.hosts
      ip_version = matrix.ip_version
      rollback_release = {
        edition = matrix.edition
        version = var.vault_upgrade_initial_version
      }
      vault_addr        = step.create_vault_cluster.api_addr_localhost
      vault_install_dir = global.vault_install_dir["bundle"]
      vault_root_token  = step.create_vault_cluster.root_token
      vault_seal_type   = matrix.seal
      vault_unseal_keys = matrix.seal == "shamir" ? step.create_vault_cluster.unseal_keys_hex : null
    }
  }

  step "wait_for_leader_after_rollback" {
    description = global.description.wait_for_cluster_to_have_leader
    module      = module.vault_wait_for_leader
    depends_on  = [step.execute_rollback]

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
      vault_install_dir = global.vault_install_dir["bundle"]
      vault_root_token  = step.create_vault_cluster.root_token
    }
  }

  # WO-052 AC2: confirm the cluster returned to its pre-change state -- all 3 nodes are Raft
  # voters again after rollback.
  step "verify_raft_voters_after_rollback" {
    description = "Confirm all 3 Raft voters are present after rollback"
    module      = module.vault_verify_raft_auto_join_voter
    depends_on  = [step.wait_for_leader_after_rollback]

    providers = {
      enos = provider.enos.ubuntu
    }

    verifies = [
      quality.vault_raft_voters,
    ]

    variables {
      hosts                   = step.create_vault_cluster.hosts
      ip_version              = matrix.ip_version
      vault_addr              = step.create_vault_cluster.api_addr_localhost
      vault_cluster_addr_port = step.create_vault_cluster.cluster_port
      vault_install_dir       = global.vault_install_dir["bundle"]
      vault_root_token        = step.create_vault_cluster.root_token
    }
  }

  step "get_vault_cluster_ips_after_rollback" {
    description = global.description.get_vault_cluster_ip_addresses
    module      = module.vault_get_cluster_ips
    depends_on  = [step.verify_raft_voters_after_rollback]

    providers = {
      enos = provider.enos.ubuntu
    }

    variables {
      hosts             = step.create_vault_cluster.hosts
      ip_version        = matrix.ip_version
      vault_addr        = step.create_vault_cluster.api_addr_localhost
      vault_install_dir = global.vault_install_dir["bundle"]
      vault_root_token  = step.create_vault_cluster.root_token
    }
  }

  # WO-052 AC4: the secret written before the upgrade must still be readable, with the correct
  # value, after rollback.
  step "verify_rollback_test_secret" {
    description = "Verify secret/data/rollback-test is still readable with the correct value after rollback"
    module      = module.vault_verify_rollback_data
    depends_on  = [step.get_vault_cluster_ips_after_rollback]

    providers = {
      enos = provider.enos.ubuntu
    }

    verifies = [
      quality.vault_rollback_data_integrity_preserved,
    ]

    variables {
      mode              = "verify"
      leader_host       = step.get_vault_cluster_ips_after_rollback.leader_host
      vault_addr        = step.create_vault_cluster.api_addr_localhost
      vault_install_dir = global.vault_install_dir["bundle"]
      vault_root_token  = step.create_vault_cluster.root_token
    }
  }

  # WO-052 AC6: the SLA clock stops here -- "after all health checks pass" -- covering the
  # rollback binary swap/restart/unseal (execute_rollback), leader election, Raft voter
  # convergence, and the AC4 data-integrity read above.
  step "assert_rollback_within_sla" {
    description = "Assert total rollback wall-clock duration is under the 1800 second (30 minute) SLA"
    module      = module.vault_rollback_timer
    depends_on  = [step.verify_rollback_test_secret]

    verifies = [
      quality.vault_rollback_within_sla,
    ]

    variables {
      start_epoch = step.mark_rollback_start.epoch
      sla_seconds = local.rollback_sla_seconds
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

  output "rollback_elapsed_seconds" {
    description = "WO-052 AC6: measured rollback wall-clock duration, in seconds"
    value       = step.assert_rollback_within_sla.elapsed_seconds
  }
}
