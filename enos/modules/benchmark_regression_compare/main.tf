# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

# benchmark_regression_compare closes the automated-regression-comparison gap
# in the benchmark scenario (WO-053): it runs enos/k6/perf-regression.js
# against the freshly provisioned Vault cluster from the k6 host that
# set_up_k6 already installed k6 on, measures unseal time against the leader
# via enos/scripts/measure-unseal-time.sh, and compares both against
# enos/benchmarks/baseline.json with enos/scripts/compare-benchmarks.sh --
# failing the step (and therefore the scenario) if either
# quality.vault_api_p99_latency_regression or quality.vault_unseal_time_regression
# is violated.
terraform {
  required_providers {
    enos = {
      source = "registry.terraform.io/hashicorp-forge/enos"
    }
  }
}

variable "k6_host" {
  type = object({
    ipv6       = string
    private_ip = string
    public_ip  = string
  })
  description = "The k6 load generator host that set_up_k6 already installed k6 on"
}

variable "leader_addr" {
  type        = string
  description = "The Vault cluster leader's private IP"
}

variable "leader_host" {
  type = object({
    ipv6       = string
    private_ip = string
    public_ip  = string
  })
  description = "The Vault cluster leader host, used to measure unseal time"
}

variable "vault_token" {
  type        = string
  description = "The Vault cluster root token"
}

variable "vault_unseal_keys" {
  type        = list(string)
  description = "The Shamir unseal keys (base64), used to time a manual re-unseal cycle. Leave empty for auto-unseal clusters."
  default     = []
}

variable "vault_install_dir" {
  type        = string
  description = "The directory the Vault binary is installed in on the leader host"
}

variable "baseline_path" {
  type        = string
  description = "Path (on the Enos runner) to the committed baseline snapshot"
  default     = "enos/benchmarks/baseline.json"
}

variable "results_path" {
  type        = string
  description = "Path (on the Enos runner) to write the latest snapshot for CI artifact upload"
  default     = "enos/benchmarks/latest.json"
}

resource "enos_file" "perf_regression_script" {
  destination = "/home/ubuntu/scripts/perf-regression.js"
  content     = file("${path.module}/../../k6/perf-regression.js")

  transport = {
    ssh = {
      host = var.k6_host.public_ip
    }
  }
}

# Run the k6 workload from the k6 host against the cluster leader and print
# the handleSummary() JSON (the "endpoints" snapshot) to stdout, which Enos
# captures as this resource's `stdout` output.
resource "enos_remote_exec" "run_perf_regression" {
  depends_on = [enos_file.perf_regression_script]

  environment = {
    VAULT_ADDR        = "http://${var.leader_addr}:8200"
    VAULT_TOKEN       = var.vault_token
    PERF_INSECURE_TLS = "false"
  }

  inline = [
    "k6 run /home/ubuntu/scripts/perf-regression.js",
  ]

  transport = {
    ssh = {
      host = var.k6_host.public_ip
    }
  }
}

# Measure unseal time against the leader. For Shamir clusters this reseals
# the leader and times the real unseal-key-submission-to-healthy cycle; for
# auto-unseal clusters (var.vault_unseal_keys empty) it skips the reseal and
# just times how long the node takes to report healthy from invocation,
# per WO-053 AC4.
resource "enos_remote_exec" "measure_unseal_time" {
  depends_on = [enos_remote_exec.run_perf_regression]

  environment = {
    VAULT_ADDR  = "https://${var.leader_addr}:8200"
    UNSEAL_KEYS = join(",", var.vault_unseal_keys)
  }

  scripts = [abspath("${path.module}/../../scripts/measure-unseal-time.sh")]

  transport = {
    ssh = {
      host = var.leader_host.public_ip
    }
  }
}

# Assemble the latest.json snapshot (perf-regression's endpoint metrics +
# the unseal-time measurement) and compare it against the committed
# baseline.json, on the Enos runner where the repo checkout (and therefore
# baseline.json) lives. Exits 1 -- failing this step, and therefore the
# scenario -- if compare-benchmarks.sh finds a threshold breach.
resource "enos_local_exec" "compare_against_baseline" {
  depends_on = [enos_remote_exec.measure_unseal_time]

  environment = {
    K6_SUMMARY_JSON    = enos_remote_exec.run_perf_regression.stdout
    UNSEAL_RESULT_JSON = enos_remote_exec.measure_unseal_time.stdout
    BASELINE_PATH      = var.baseline_path
    RESULTS_PATH       = var.results_path
  }

  inline = [
    "jq -s '.[0] * {unseal_time_seconds: .[1].unseal_time_seconds, seal_type: .[1].seal_type}' <(echo \"$K6_SUMMARY_JSON\") <(echo \"$UNSEAL_RESULT_JSON\") > \"$RESULTS_PATH\"",
    "enos/scripts/compare-benchmarks.sh \"$BASELINE_PATH\" \"$RESULTS_PATH\" \"$(dirname \"$RESULTS_PATH\")/comparison-report.json\"",
  ]
}

output "comparison_report_stdout" {
  description = "The compare-benchmarks.sh report (also written to comparison-report.json alongside results_path)"
  value       = enos_local_exec.compare_against_baseline.stdout
}
