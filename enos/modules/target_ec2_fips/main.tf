# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

# target_ec2_fips provisions RHEL 9 EC2 instances with OS-level FIPS mode
# enabled (the fips=1 kernel boot parameter), for use as the FIPS-aligned
# deployment target in enos-scenario-fips.hcl (WO-060). It mirrors
# ../target_ec2_instances' target/security-group/IAM conventions, but its
# user_data additionally installs dracut-fips, runs
# `fips-mode-setup --enable`, and reboots -- fips=1 is a kernel boot
# parameter baked into the initramfs/cmdline by fips-mode-setup and cannot
# take effect without a reboot (see
# https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/9/html/security_hardening/switching-the-system-to-fips-mode_security-hardening).
#
# Enabling FIPS mode requires a reboot (WO-060 edge case): the enos
# provider's SSH transport retries connection attempts with backoff, so the
# enos_remote_exec resource below naturally waits out the reboot cycle
# instead of requiring bespoke wait-for-ssh logic. As defense in depth,
# scripts/wait-for-fips-boot.sh additionally retries its own assertion a
# few times in case SSH reconnects slightly before the new initramfs is
# fully active.

terraform {
  required_providers {
    enos = {
      source = "registry.terraform.io/hashicorp-forge/enos"
    }
  }
}

data "aws_vpc" "vpc" {
  id = var.vpc_id
}

data "aws_ami" "ami" {
  filter {
    name   = "image-id"
    values = [var.ami_id]
  }

  timeouts {
    read = "5m"
  }
}

data "aws_ec2_instance_type_offerings" "instance" {
  filter {
    name   = "instance-type"
    values = [local.instance_type]
  }

  location_type = "availability-zone"

  timeouts {
    read = "5m"
  }
}

data "aws_availability_zones" "available" {
  state = "available"

  filter {
    name   = "zone-name"
    values = data.aws_ec2_instance_type_offerings.instance.locations
  }

  timeouts {
    read = "5m"
  }
}

data "aws_subnets" "vpc" {
  filter {
    name   = "availability-zone"
    values = data.aws_availability_zones.available.names
  }

  filter {
    name   = "vpc-id"
    values = [var.vpc_id]
  }

  timeouts {
    read = "5m"
  }
}

data "aws_iam_policy_document" "target" {
  statement {
    resources = ["*"]

    actions = [
      "ec2:DescribeInstances",
      "secretsmanager:*"
    ]
  }

  dynamic "statement" {
    for_each = var.seal_key_names

    content {
      resources = [statement.value]

      actions = [
        "kms:DescribeKey",
        "kms:ListKeys",
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:GenerateDataKey"
      ]
    }
  }
}

data "aws_iam_policy_document" "target_instance_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

data "enos_environment" "localhost" {}

locals {
  cluster_name  = coalesce(var.cluster_name, random_string.cluster_name.result)
  instance_type = local.instance_types[data.aws_ami.ami.architecture]
  instance_types = {
    "arm64"  = var.instance_types["arm64"]
    "x86_64" = var.instance_types["amd64"]
  }
  instances   = toset([for idx in range(var.instance_count) : tostring(idx)])
  name_prefix = "${var.project_name}-${local.cluster_name}-${random_string.unique_id.result}"

  # dracut-fips + `fips-mode-setup --enable` regenerate the initramfs with
  # the FIPS module and add fips=1 (and boot=UUID=<root>) to the kernel
  # command line. The reboot is backgrounded so cloud-init can report
  # success before the instance goes down for the reboot.
  fips_enable_user_data = <<-EOT
    #!/bin/bash
    set -euo pipefail
    exec > /var/log/target-ec2-fips-userdata.log 2>&1

    echo "target_ec2_fips: installing dracut-fips"
    dnf install -y dracut-fips

    echo "target_ec2_fips: enabling FIPS mode"
    fips-mode-setup --enable

    echo "target_ec2_fips: FIPS mode enabled, rebooting to apply the fips=1 kernel parameter"
    ( sleep 5 && /sbin/reboot ) &
  EOT
}

resource "random_string" "cluster_name" {
  length  = 8
  lower   = true
  upper   = false
  numeric = false
  special = false
}

resource "random_string" "unique_id" {
  length  = 4
  lower   = true
  upper   = false
  numeric = false
  special = false
}

resource "time_static" "create_time" {
}

resource "aws_iam_role" "target_instance_role" {
  name               = "${local.name_prefix}-instance-role"
  assume_role_policy = data.aws_iam_policy_document.target_instance_role.json
}

resource "aws_iam_instance_profile" "target" {
  name = "${local.name_prefix}-instance-profile"
  role = aws_iam_role.target_instance_role.name
  tags = {
    CreateTime = time_static.create_time.rfc3339
  }
}

resource "aws_iam_role_policy" "target" {
  name   = "${local.name_prefix}-role-policy"
  role   = aws_iam_role.target_instance_role.id
  policy = data.aws_iam_policy_document.target.json
}

resource "aws_security_group" "target" {
  name        = "${local.name_prefix}-sg"
  description = "FIPS target instance security group"
  vpc_id      = var.vpc_id

  # External ingress
  dynamic "ingress" {
    for_each = var.ports_ingress

    content {
      from_port = ingress.value.port
      to_port   = ingress.value.port
      protocol  = ingress.value.protocol
      cidr_blocks = flatten([
        formatlist("%s/32", data.enos_environment.localhost.public_ipv4_addresses),
        join(",", data.aws_vpc.vpc.cidr_block_associations.*.cidr_block),
        formatlist("%s/32", var.ssh_allow_ips)
      ])
      ipv6_cidr_blocks = data.aws_vpc.vpc.ipv6_cidr_block != "" ? [data.aws_vpc.vpc.ipv6_cidr_block] : null
    }
  }

  # Internal traffic
  ingress {
    from_port = 0
    to_port   = 0
    protocol  = "-1"
    self      = true
  }

  # External traffic
  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = merge(
    var.common_tags,
    {
      Name = "${local.name_prefix}-sg"
    },
  )
}

resource "aws_instance" "targets" {
  for_each = local.instances

  ami                  = var.ami_id
  iam_instance_profile = aws_iam_instance_profile.target.name
  // Some scenarios (autopilot, pr_replication) shutdown instances to simulate failure. In those
  // cases we should terminate the instance entirely rather than get stuck in stopped limbo.
  instance_initiated_shutdown_behavior = "terminate"
  instance_type                        = local.instance_type
  key_name                             = var.ssh_keypair
  subnet_id                            = data.aws_subnets.vpc.ids[tonumber(each.key) % length(data.aws_subnets.vpc.ids)]
  vpc_security_group_ids               = [aws_security_group.target.id]
  ebs_optimized                        = var.ebs_optimized
  user_data                            = local.fips_enable_user_data

  root_block_device {
    encrypted   = true
    iops        = var.root_volume_iops
    volume_size = var.root_volume_size
    volume_type = var.root_volume_type
  }

  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  tags = merge(
    var.common_tags,
    {
      Name                     = "${local.name_prefix}-${var.cluster_tag_key}-fips-instance-target"
      "${var.cluster_tag_key}" = local.cluster_name
    },
  )

  timeouts {
    create = "10m"
    update = "10m"
    delete = "10m"
  }
}

module "disable_selinux" {
  depends_on = [aws_instance.targets]
  source     = "../disable_selinux"
  count      = var.disable_selinux == true ? 1 : 0

  hosts = local.hosts
}

# Verify the fips=1 kernel parameter took effect after the FIPS-enabling
# reboot in user_data (AC: "verified by running 'cat
# /proc/sys/crypto/fips_enabled' returning '1' via enos_remote_exec").
resource "enos_remote_exec" "verify_fips_reboot" {
  for_each = local.hosts

  scripts = [abspath("${path.module}/scripts/wait-for-fips-boot.sh")]

  transport = {
    ssh = {
      host = each.value.public_ip
    }
  }
}
