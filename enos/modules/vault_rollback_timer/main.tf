# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

# vault_rollback_timer measures the WO-052 30-minute (1800s) rollback recovery SLA. Invoke it
# twice per scenario run:
#   1. Once with var.start_epoch left null, immediately before the rollback module executes. Use
#      its `epoch` output as the SLA clock's start time.
#   2. Once after every post-rollback health and data-integrity check has passed, passing the
#      first invocation's `epoch` output back in as var.start_epoch. This second invocation both
#      prints the measured duration to stdout (WO-052 AC6: "the measured duration is recorded in
#      the test output") and fails the `terraform apply` -- and therefore the enos scenario run
#      -- if the elapsed time is >= var.sla_seconds (WO-052 AC6: "hard assertion that total time
#      is less than 1800 seconds").
terraform {
  required_providers {
    enos = {
      source = "registry.terraform.io/hashicorp-forge/enos"
    }
  }
}

variable "start_epoch" {
  type        = number
  description = "The `epoch` output from a prior start invocation of this module. Leave unset (null) for the start invocation itself."
  default     = null
}

variable "sla_seconds" {
  type        = number
  description = "The rollback recovery SLA, in seconds, that the elapsed time must stay under"
  default     = 1800
}

resource "enos_local_exec" "mark" {
  scripts = [abspath("${path.module}/scripts/mark-epoch.sh")]
}

locals {
  epoch           = tonumber(trimspace(enos_local_exec.mark.stdout))
  elapsed_seconds = var.start_epoch == null ? null : local.epoch - var.start_epoch
}

resource "enos_local_exec" "assert_within_sla" {
  count      = var.start_epoch == null ? 0 : 1
  depends_on = [enos_local_exec.mark]

  environment = {
    ELAPSED_SECONDS = local.elapsed_seconds
    SLA_SECONDS     = var.sla_seconds
  }

  scripts = [abspath("${path.module}/scripts/assert-within-sla.sh")]
}

output "epoch" {
  description = "Unix epoch seconds when this module ran; feed into the next invocation's start_epoch"
  value       = local.epoch
}

output "elapsed_seconds" {
  description = "Seconds elapsed since start_epoch; null on the start invocation"
  value       = local.elapsed_seconds
}
