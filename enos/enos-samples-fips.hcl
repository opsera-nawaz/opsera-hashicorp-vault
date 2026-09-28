// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: BUSL-1.1

// enos-samples-fips.hcl defines the CE FIPS-specific Enos sample used to
// exercise the "fips" scenario (enos-scenario-fips.hcl, WO-060) in CI. It
// follows the pattern of enos/k8s/enos-samples-ce.hcl: a small, fixed
// subset matrix rather than the wide multi-dimensional matrix used by
// enos-samples-ce-build.hcl/enos-samples-ce-release.hcl, since the fips
// scenario's own matrix only has two dimensions (arch, edition) and
// edition only has one legal value ("ce.fips").
//
// The AWS region (var.aws_region) and the AWS KMS FIPS endpoint
// (var.kms_fips_endpoint) are not sample matrix dimensions -- both must be
// set per-run to a real, region-matched pair (FIPS endpoints are
// region-specific) via enos.vars.hcl or -var flags, e.g.:
//   aws_region        = "us-east-1"
//   kms_fips_endpoint = "kms-fips.us-east-1.amazonaws.com"
// The RHEL 9 AMI is resolved dynamically via module.ec2_info from
// var.distro_version_rhel_fips, exactly as every other AWS-backed scenario
// in this repo resolves its AMI (see enos-scenario-smoke.hcl step
// "ec2_info").

sample "fips_ce_linux_amd64_rhel9" {
  subset "fips" {
    matrix {
      arch    = ["amd64"]
      edition = ["ce.fips"]
    }
  }
}

sample "fips_ce_linux_arm64_rhel9" {
  subset "fips" {
    matrix {
      arch    = ["arm64"]
      edition = ["ce.fips"]
    }
  }
}
