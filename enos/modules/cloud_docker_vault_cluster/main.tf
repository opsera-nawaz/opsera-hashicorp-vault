# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

terraform {
  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
    enos = {
      source = "registry.terraform.io/hashicorp-forge/enos"
    }
  }
}

variable "min_vault_version" {
  type        = string
  description = "The minimum Vault version to deploy (e.g., 1.15.0 or v1.15.0+ent)"
}

variable "vault_edition" {
  type        = string
  description = "The edition of Vault to deploy (ent, ce, ent.fips1403, ce.fips)"
  default     = "ent"

  validation {
    condition     = contains(["ent", "ce", "ent.fips1403", "ce.fips"], var.vault_edition)
    error_message = "vault_edition must be one of: ent, ce, ent.fips1403, ce.fips"
  }
}

variable "seal_type" {
  type        = string
  description = "The seal mechanism to use. \"shamir\" (default) initializes with manual unseal keys; \"awskms\" auto-unseals using var.seal_attributes (kms_key_id, region, and optionally a FIPS endpoint)"
  default     = "shamir"

  validation {
    condition     = contains(["shamir", "awskms"], var.seal_type)
    error_message = "seal_type must be one of: shamir, awskms"
  }
}

variable "seal_attributes" {
  type        = map(string)
  description = "Seal device attributes for var.seal_type = \"awskms\" (as produced by module.seal_awskms's `attributes` output): kms_key_id (required), region (defaults to us-east-1), endpoint (optional, e.g. a FIPS endpoint)"
  default     = {}
}

variable "aws_access_key_id" {
  type        = string
  description = "Optional AWS access key injected into the Vault container's environment so an awskms seal can reach AWS KMS. Not needed when the container can otherwise reach AWS (e.g. host IAM credentials mounted into the container)."
  default     = null
  sensitive   = true
}

variable "aws_secret_access_key" {
  type        = string
  description = "Optional AWS secret key, paired with var.aws_access_key_id"
  default     = null
  sensitive   = true
}

variable "aws_session_token" {
  type        = string
  description = "Optional AWS session token, paired with var.aws_access_key_id for temporary credentials"
  default     = null
  sensitive   = true
}

variable "vault_license" {
  type        = string
  description = "The Vault Enterprise license"
  default     = null
  sensitive   = true
}

variable "cluster_name" {
  type        = string
  description = "The name of the Vault cluster"
  default     = "vault"
}

variable "container_count" {
  type        = number
  description = "Number of Vault containers to create"
  default     = 3
}

variable "vault_port" {
  type        = number
  description = "The port Vault listens on"
  default     = 8200
}

variable "use_local_build" {
  type        = bool
  description = "If true, build a local Docker image from the current branch instead of pulling from Docker Hub"
  default     = false
}

# HCP-specific variables (ignored but accepted for compatibility)
variable "network_name" {
  type        = string
  description = "Ignored - for HCP compatibility only"
  default     = ""
}

variable "tier" {
  type        = string
  description = "Ignored - for HCP compatibility only"
  default     = ""
}

# Generate a random suffix for the network name to avoid conflicts
resource "random_string" "network_suffix" {
  length  = 8
  lower   = true
  upper   = false
  numeric = true
  special = false
}

# Create Docker network
resource "docker_network" "cluster" {
  name = "${var.cluster_name}-network-${random_string.network_suffix.result}"
}

locals {
  # Parse min_vault_version to extract the version number
  # e.g., "v1.15.0+ent" -> "1.15.0" or "v1.15.0+ent-2cf0b2f" -> "1.15.0"
  vault_version = trimprefix(split("+", var.min_vault_version)[0], "v")

  image_map = {
    "ent"          = "hashicorp/vault-enterprise"
    "ce"           = "hashicorp/vault"
    "ent.fips1403" = "hashicorp/vault-enterprise-fips"
    "ce.fips"      = "hashicorp/vault"
  }
  target_map = {
    "ent"          = "ubi"
    "ce"           = "ubi"
    "ent.fips1403" = "ubi-fips"
    # NOT "ubi-fips": the Dockerfile's own doc-comment on the "ubi" stage
    # (WO-046) is explicit that "ubi-fips"/"ubi-hsm-fips" are
    # Enterprise-only targets that "do not exist in this CE Dockerfile" --
    # the CE FIPS-path image is the "ubi" target itself (glibc/UBI base
    # with the OpenSSL FIPS provider installed), exactly as
    # enos/modules/verify_fips_startup/scripts/build-and-verify.sh already
    # builds it (`docker build --target ubi`).
    "ce.fips" = "ubi"
  }
  image      = local.image_map[var.vault_edition]
  tag_suffix = var.vault_edition == "ce" ? "" : "-ent"
  image_tag  = "${local.vault_version}${local.tag_suffix}"
  local_tag  = "vault-local-${var.vault_edition}:${local.vault_version}"
  dockerfile = "Dockerfile"
  target     = local.target_map[var.vault_edition]
}

# "ce.fips" has no published container image yet (see WO-060 / WO-046):
# unlike "ent.fips1403", which HashiCorp publishes to Docker Hub, the CE
# FIPS-path UBI image only exists as a local Dockerfile build target. Fail
# fast with a clear message here instead of silently pulling the
# non-FIPS "ce" image tag from docker_image.vault_remote (edge case from
# WO-060: "the scenario must fail with a clear error message rather than
# silently falling back to a non-FIPS image").
output "_require_local_build_for_ce_fips" {
  description = "Internal guard (not a consumable value): fails plan/apply when vault_edition = \"ce.fips\" is requested without use_local_build = true."
  value       = null

  precondition {
    condition     = var.vault_edition != "ce.fips" || var.use_local_build
    error_message = "cloud_docker_vault_cluster: vault_edition \"ce.fips\" has no published container image; set use_local_build = true to build the FIPS-path UBI image locally from the Dockerfile's \"ubi-fips\" target instead of silently falling back to a non-FIPS image."
  }
}

# Pull image from Docker Hub (when not using local build)
resource "docker_image" "vault_remote" {
  count = var.use_local_build ? 0 : 1
  name  = "${local.image}:${local.image_tag}"
}

# Build image from local Dockerfile (when using local build)
resource "docker_image" "vault_local" {
  count        = var.use_local_build ? 1 : 0
  name         = local.local_tag
  keep_locally = true

  build {
    context     = "${path.module}/../../.."
    dockerfile  = local.dockerfile
    target      = local.target
    tag         = [local.local_tag]
    pull_parent = true
    build_args = {
      BIN_NAME         = "vault"
      TARGETOS         = "linux"
      TARGETARCH       = "amd64"
      NAME             = "vault"
      PRODUCT_VERSION  = local.vault_version
      PRODUCT_REVISION = "local"
      LICENSE_SOURCE   = "LICENSE"
      LICENSE_DEST     = "/usr/share/doc/vault"
    }
  }

}

locals {
  # awskms auto-unseal renders a "seal" stanza; shamir (the default) omits
  # it entirely, matching this module's existing behavior of always
  # unsealing manually via `vault operator unseal` below. Defined as its
  # own heredoc local (rather than inline in a ternary) because a heredoc's
  # closing delimiter must be alone on its line -- it can't be followed by
  # a ternary's ": <else>" on the same line.
  seal_stanza_awskms = <<-EOT
    seal "awskms" {
      kms_key_id = "${lookup(var.seal_attributes, "kms_key_id", "")}"
      region     = "${lookup(var.seal_attributes, "region", "us-east-1")}"
      %{if lookup(var.seal_attributes, "endpoint", "") != ""}
      endpoint = "${var.seal_attributes["endpoint"]}"
      %{endif}
    }
  EOT

  seal_stanza = var.seal_type == "awskms" ? local.seal_stanza_awskms : ""

  # Generate Vault configuration for each node. This used to be a single
  # format()-able template with a "node%s" placeholder; it's now a
  # per-instance list so that local.seal_stanza never has to pass through
  # a second, unrelated printf-style substitution.
  vault_config_templates = [for idx in range(var.container_count) : <<-EOF
    ui = true
    listener "tcp" {
      address = "0.0.0.0:${var.vault_port}"
      cluster_address = "0.0.0.0:8201"
      tls_disable = true
    }

    storage "raft" {
      path = "/vault/data"
      node_id = "node${idx}"
    }

    ${local.seal_stanza}
    disable_mlock = true
  EOF
  ]
}

# Using tmpfs for Raft data (in-memory, no persistence needed for testing)

resource "docker_container" "vault" {
  count = var.container_count
  name  = "${var.cluster_name}-${count.index}"
  image = var.use_local_build ? docker_image.vault_local[0].name : docker_image.vault_remote[0].image_id

  networks_advanced {
    name = docker_network.cluster.name
  }

  ports {
    internal = var.vault_port
    external = var.vault_port + count.index
  }

  tmpfs = {
    "/vault/data" = "rw,noexec,nosuid,size=100m"
  }

  upload {
    content = local.vault_config_templates[count.index]
    file    = "/vault/config/vault.hcl"
  }


  user = "root"

  env = concat(
    [
      "VAULT_API_ADDR=http://${var.cluster_name}-${count.index}:${var.vault_port}",
      "VAULT_CLUSTER_ADDR=http://${var.cluster_name}-${count.index}:8201",
      "SKIP_SETCAP=true",
      "SKIP_CHOWN=true",
    ],
    var.vault_license != null ? ["VAULT_LICENSE=${var.vault_license}"] : [],
    var.aws_access_key_id != null ? ["AWS_ACCESS_KEY_ID=${var.aws_access_key_id}"] : [],
    var.aws_secret_access_key != null ? ["AWS_SECRET_ACCESS_KEY=${var.aws_secret_access_key}"] : [],
    var.aws_session_token != null ? ["AWS_SESSION_TOKEN=${var.aws_session_token}"] : [],
    lookup(var.seal_attributes, "region", "") != "" ? ["AWS_REGION=${var.seal_attributes["region"]}"] : []
  )

  capabilities {
    add = ["IPC_LOCK"]
  }

  command = ["vault", "server", "-config=/vault/config/vault.hcl"]

  restart  = "no"
  must_run = true
}

# Capture container logs immediately after creation
resource "null_resource" "capture_logs" {
  count = var.container_count

  provisioner "local-exec" {
    command = "docker logs ${docker_container.vault[count.index].name} 2>&1 > /tmp/vault-${docker_container.vault[count.index].name}-startup.log || docker inspect ${docker_container.vault[count.index].name} 2>&1 > /tmp/vault-${docker_container.vault[count.index].name}-inspect.log || true"
  }

  depends_on = [docker_container.vault]

  triggers = {
    container_id = docker_container.vault[count.index].id
  }
}

locals {
  instance_indexes = [for idx in range(var.container_count) : tostring(idx)]
  leader_idx       = 0
  followers_idx    = range(1, var.container_count)

  vault_address   = "http://127.0.0.1:${var.vault_port}"
  leader_api_addr = "http://${var.cluster_name}-${local.leader_idx}:${var.vault_port}"

  # awskms auto-unseal means `vault operator init` unseals the leader (and
  # every follower, on raft join) automatically -- there is no Shamir
  # unseal key to generate or apply.
  is_auto_unseal = var.seal_type != "shamir"
  init_flags     = local.is_auto_unseal ? "-recovery-shares=1 -recovery-threshold=1" : "-key-shares=1 -key-threshold=1"
}

# Initialize Vault on the leader
resource "enos_local_exec" "init_leader" {
  inline = [
    <<-EOT
      # Check for recently exited containers first
      EXITED_CONTAINER=$(docker ps -a --filter "name=${docker_container.vault[local.leader_idx].name}" --filter "status=exited" --format "{{.Names}}" | head -1)
      if [ -n "$EXITED_CONTAINER" ]; then
        echo "Container $EXITED_CONTAINER exited. Logs:" >&2
        docker logs $EXITED_CONTAINER 2>&1 >&2
        echo "Exit code: $(docker inspect $EXITED_CONTAINER --format='{{.State.ExitCode}}')" >&2
        exit 1
      fi

      # Wait for Vault to be ready (output to stderr to keep stdout clean)
      for i in 1 2 3 4 5 6 7 8 9 10; do
        # Check if container exists and is running
        if ! docker ps --filter "name=${docker_container.vault[local.leader_idx].name}" --format "{{.Names}}" | grep -q "${docker_container.vault[local.leader_idx].name}"; then
          echo "Container ${docker_container.vault[local.leader_idx].name} is not running. Checking for exited container..." >&2
          EXITED=$(docker ps -a --filter "name=${docker_container.vault[local.leader_idx].name}" --filter "status=exited" --format "{{.Names}}" | head -1)
          if [ -n "$EXITED" ]; then
            echo "Found exited container. Logs:" >&2
            docker logs $EXITED 2>&1 >&2
          else
            echo "Container not found at all" >&2
          fi
          exit 1
        fi

        if docker exec -e VAULT_ADDR=http://127.0.0.1:${var.vault_port} ${docker_container.vault[local.leader_idx].name} vault status 2>&1 | grep -q "Initialized.*false"; then
          break
        fi
        echo "Waiting for Vault to start (attempt $i/10)..." >&2
        sleep 2
      done

      # Initialize Vault and output JSON to stdout
      docker exec -e VAULT_ADDR=http://127.0.0.1:${var.vault_port} ${docker_container.vault[local.leader_idx].name} vault operator init \
        ${local.init_flags} \
        -format=json
    EOT
  ]

  depends_on = [docker_container.vault]
}

locals {
  init_data  = jsondecode(enos_local_exec.init_leader.stdout)
  unseal_key = local.is_auto_unseal ? "" : local.init_data.unseal_keys_b64[0]
  root_token = local.init_data.root_token
}

# Unseal the leader. Skipped entirely for awskms auto-unseal, where
# `vault operator init` above already unseals the leader.
resource "enos_local_exec" "unseal_leader" {
  count = local.is_auto_unseal ? 0 : 1

  inline = [
    "docker exec -e VAULT_ADDR=http://127.0.0.1:${var.vault_port} ${docker_container.vault[local.leader_idx].name} vault operator unseal ${local.unseal_key}"
  ]

  depends_on = [enos_local_exec.init_leader]
}

# Join followers to Raft cluster. Shamir followers additionally need an
# explicit `vault operator unseal` after joining; awskms followers
# auto-unseal on raft join.
resource "enos_local_exec" "join_followers" {
  count = length(local.followers_idx)

  inline = [
    <<-EOT
      # Wait for Vault to be ready
      for i in 1 2 3 4 5; do
        docker exec -e VAULT_ADDR=http://127.0.0.1:${var.vault_port} ${docker_container.vault[local.followers_idx[count.index]].name} vault status > /dev/null 2>&1 && break || sleep 5
      done

      # Join the Raft cluster
      docker exec -e VAULT_ADDR=http://127.0.0.1:${var.vault_port} ${docker_container.vault[local.followers_idx[count.index]].name} \
        vault operator raft join ${local.leader_api_addr}
      %{if !local.is_auto_unseal}
      # Unseal the follower
      docker exec -e VAULT_ADDR=http://127.0.0.1:${var.vault_port} ${docker_container.vault[local.followers_idx[count.index]].name} \
        vault operator unseal ${local.unseal_key}
      %{endif}
    EOT
  ]

  # unseal_leader has count = 0 for awskms (auto-unseal already happened in
  # init_leader), in which case this dependency is trivially satisfied.
  depends_on = [enos_local_exec.init_leader, enos_local_exec.unseal_leader]
}

# Outputs that match HCP module interface
output "cloud_provider" {
  value       = "docker"
  description = "The cloud provider (docker for local)"
}

output "cluster_id" {
  value       = var.cluster_name
  description = "The cluster identifier"
}

output "created_at" {
  value       = timestamp()
  description = "Timestamp of cluster creation"
}

output "id" {
  value       = var.cluster_name
  description = "The cluster identifier"
}

output "namespace" {
  value       = "root"
  description = "The Vault namespace"
}

output "organization_id" {
  value       = "docker-local"
  description = "The organization identifier"
}

output "region" {
  value       = "local"
  description = "The region or location"
}

output "self_link" {
  value       = ""
  description = "Self link to the cluster"
}

output "state" {
  value       = "RUNNING"
  description = "The state of the cluster"
}

output "vault_private_endpoint_url" {
  value       = ""
  description = "Private endpoint URL (not applicable for Docker)"
}

output "vault_proxy_endpoint_url" {
  value       = ""
  description = "Proxy endpoint URL (not applicable for Docker)"
}

output "vault_public_endpoint_url" {
  value       = "http://localhost:${var.vault_port}"
  description = "Public endpoint URL"
}

output "vault_version" {
  value       = local.vault_version
  description = "The version of Vault deployed"
}

# Docker-specific outputs
output "container_names" {
  value       = docker_container.vault[*].name
  description = "The names of the Vault containers"
}

output "container_ids" {
  value       = docker_container.vault[*].id
  description = "The IDs of the Vault containers"
}

output "vault_addresses" {
  value = [
    for i in range(var.container_count) :
    "http://localhost:${var.vault_port + i}"
  ]
  description = "The addresses of the Vault containers"
}

output "primary_address" {
  value       = "http://localhost:${var.vault_port}"
  description = "The address of the primary Vault container"
}

output "network_id" {
  value       = docker_network.cluster.id
  description = "The ID of the created Docker network"
}

output "network_name" {
  value       = docker_network.cluster.name
  description = "The name of the created Docker network"
}

output "image_name" {
  value       = var.use_local_build ? (length(docker_image.vault_local) > 0 ? docker_image.vault_local[0].name : "none") : (length(docker_image.vault_remote) > 0 ? docker_image.vault_remote[0].name : "none")
  description = "The Docker image being used"
}

output "is_local_build" {
  value       = var.use_local_build
  description = "Whether this is using a local build"
}

output "vault_root_token" {
  value       = local.root_token
  sensitive   = true
  description = "The root token for the Vault cluster"
}
