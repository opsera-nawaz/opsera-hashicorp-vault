// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: BUSL-1.1

scenario "fips" {
  description = <<-EOF
    The fips scenario is the WO-060 end-to-end FIPS infrastructure
    provisioning check: it provisions RHEL 9 EC2 instances with the fips=1
    kernel boot parameter enabled (module.target_ec2_fips), creates an AWS
    KMS auto-unseal key configured with a region-specific FIPS endpoint
    (module.seal_awskms, var.kms_fips_endpoint), builds and deploys the
    "ce.fips" edition's UBI/BoringCrypto Vault container image via Docker
    (module.cloud_docker_vault_cluster), and runs FIPS-aligned-posture
    verification checks (module.verify_fips_runtime_ec2).

    This scenario never claims Vault -- or any host, image, or algorithm it
    provisions -- is "FIPS certified" or "FIPS validated"; it reports only
    the raw, re-verifiable observations documented in
    enos/modules/verify_fips_runtime_ec2/scripts/verify-fips.sh.

    # Design note: where each check runs

    module.cloud_docker_vault_cluster deploys to the local Docker daemon of
    whatever host runs `enos scenario run fips` (the Enos runner) -- that's
    an existing, unchanged property of the module (its only other consumer,
    the fips_startup scenario, is documented as "entirely local" for the
    same reason), not something introduced here. Terraform's `docker`
    provider requires a single, statically-configured daemon host
    (enos-providers.hcl's `provider "docker" "default"`), and Enos's
    per-step model has no supported way to point that provider at a host
    address that's only known from a prior step's output (module.target_ec2_fips's
    EC2 instance). Making the two co-located on one FIPS host is real,
    valuable follow-on work (it would let the runtime evidence collection
    in WO-061 observe a Vault process that is itself running under OS-level
    FIPS mode, not just alongside a host that is) but requires either a
    bespoke remote-Docker-over-SSH deploy path or a change to
    cloud_docker_vault_cluster's provider wiring, either of which is out of
    this story's declared file scope (enos-globals.hcl, seal_awskms,
    cloud_docker_vault_cluster's image/target maps, plus new modules).

    Given that, this scenario runs the OS-level checks (FIPS mode enabled,
    OpenSSL FIPS provider active) over SSH against the real, freshly FIPS-
    enabled target_ec2_fips hosts -- genuine evidence that a FIPS-aligned
    RHEL 9 host is reachable and correctly configured -- and runs the TLS
    negotiation check locally against the actual deployed Vault listener,
    built from the same "ce.fips" UBI/BoringCrypto image. See
    enos/modules/verify_fips_runtime_ec2/main.tf for exactly how both paths are
    implemented.

    # How to run this scenario

    Requires real AWS credentials, a real VPC/subnets reachable by the
    "aws" provider, a real AWS KMS FIPS endpoint for the target region, and
    a local Docker daemon. Variables required:
      - aws_ssh_private_key_path / aws_ssh_keypair_name
      - kms_fips_endpoint (e.g. "kms-fips.us-east-1.amazonaws.com";
        must match aws_region)
  EOF

  matrix {
    arch    = global.archs
    edition = ["ce.fips"]
  }

  terraform_cli = terraform_cli.default
  terraform     = terraform.default

  providers = [
    provider.aws.default,
    provider.docker.default,
    provider.enos.ec2_user,
    provider.time.default,
  ]

  step "get_local_metadata" {
    description = "Read the local branch's version and git revision, used to tag the locally-built ce.fips UBI image"
    module      = module.get_local_metadata
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
      ip_version  = "4"
    }
  }

  step "create_seal_key" {
    description = "Create the AWS KMS key backing FIPS auto-unseal, configured with a region-specific FIPS endpoint"
    module      = module.seal_awskms
    depends_on  = [step.create_vpc]

    variables {
      cluster_id   = step.create_vpc.id
      common_tags  = global.tags
      edition      = matrix.edition
      kms_endpoint = coalesce(var.kms_fips_endpoint, "")
    }
  }

  step "create_fips_targets" {
    description = "Provision RHEL 9 EC2 instances with the fips=1 kernel boot parameter enabled"
    module      = module.target_ec2_fips
    depends_on  = [step.create_vpc, step.ec2_info]

    variables {
      ami_id          = step.ec2_info.ami_ids[matrix.arch]["rhel"][var.distro_version_rhel_fips]
      cluster_tag_key = global.vault_tag_key
      common_tags     = global.tags
      instance_count  = 1
      seal_key_names  = step.create_seal_key.resource_names
      vpc_id          = step.create_vpc.id
    }
  }

  step "deploy_vault" {
    description = "Build the ce.fips-tagged UBI/BoringCrypto Vault image locally and deploy it via Docker with AWS KMS FIPS auto-unseal"
    module      = module.cloud_docker_vault_cluster
    depends_on  = [step.get_local_metadata, step.create_seal_key]

    variables {
      cluster_name      = "vault-fips-${step.create_vpc.id}"
      container_count   = 1
      min_vault_version = step.get_local_metadata.version
      seal_attributes   = merge(step.create_seal_key.attributes, { region = var.aws_region })
      seal_type         = "awskms"
      use_local_build   = true
      vault_edition     = matrix.edition
    }
  }

  step "verify_fips_runtime_ec2" {
    description = "Verify OS-level FIPS mode + OpenSSL FIPS provider on the provisioned RHEL 9 hosts, and Approved-only TLS negotiation against the deployed Vault listener"
    module      = module.verify_fips_runtime_ec2
    depends_on  = [step.create_fips_targets, step.deploy_vault]

    verifies = [
      quality.vault_fips_os_mode_enabled,
      quality.vault_fips_openssl_provider_active,
      quality.vault_fips_tls_negotiation_approved,
    ]

    variables {
      hosts      = step.create_fips_targets.hosts
      vault_addr = step.deploy_vault.vault_public_endpoint_url
    }
  }

  output "fips_hosts" {
    description = "The FIPS-enabled EC2 target hosts"
    value       = step.create_fips_targets.hosts
  }

  output "vault_addr" {
    description = "The deployed Vault cluster's public endpoint"
    value       = step.deploy_vault.vault_public_endpoint_url
  }

  output "os_fips_check_results" {
    description = "Per-host OS-level FIPS mode + OpenSSL FIPS provider verification output"
    value       = step.verify_fips_runtime_ec2.os_fips_check_results
  }

  output "tls_negotiation_result" {
    description = "Vault listener TLS negotiation verification output"
    value       = step.verify_fips_runtime_ec2.tls_negotiation_result
  }
}
