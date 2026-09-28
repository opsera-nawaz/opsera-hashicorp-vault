# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

# verify_fips_startup is the WO-055 system integration check for quality
# gates FIPS-RUNTIME-001 / FIPS-CONTAINER-001: it builds a fips-tagged
# Vault binary, builds the FIPS-path UBI container image (WO-046,
# Dockerfile `ubi` target), and runs
# enos/scripts/verify-fips-startup.sh against it to confirm Vault's
# startup FIPS mode verification (vault/fips_check.go, WO-055) behaves
# correctly for the runner it executes on -- fails closed with the
# expected FATAL message on a non-FIPS host, or starts and logs the
# expected success message on a FIPS-enabled host (see
# enos/scripts/verify-fips-startup.sh for exactly how each case is
# distinguished).
#
# This intentionally builds and runs the image with a plain native `go
# build` + `docker build`/`docker run`, rather than reusing
# module.build_local, because build_local's build.sh hardcodes
# CGO_ENABLED=0, which is incompatible with the "fips" build tag (see
# helper/constants/fips_cgo_check.go, which deliberately fails the build
# if fips is requested without cgo).

terraform {
  required_providers {
    enos = {
      source = "registry.terraform.io/hashicorp-forge/enos"
    }
  }
}

variable "image_tag" {
  type        = string
  description = "The docker image tag to build and verify, e.g. vault:1.2.3-fips-startup-check"
}

variable "product_version" {
  type        = string
  description = "The PRODUCT_VERSION build-arg passed to the Dockerfile ubi target"
}

variable "product_revision" {
  type        = string
  description = "The PRODUCT_REVISION build-arg passed to the Dockerfile ubi target, e.g. a short git SHA"
}

resource "enos_local_exec" "build_and_verify_fips_startup" {
  scripts = [abspath("${path.module}/scripts/build-and-verify.sh")]

  environment = {
    ROOT_DIR         = abspath("${path.module}/../../..")
    IMAGE_TAG        = var.image_tag
    PRODUCT_VERSION  = var.product_version
    PRODUCT_REVISION = var.product_revision
  }
}

output "image_tag" {
  value       = var.image_tag
  description = "The docker image tag that was built and verified"
}

output "stdout" {
  value       = enos_local_exec.build_and_verify_fips_startup.stdout
  description = "Combined output of the build-and-verify script, including verify-fips-startup.sh's PASS/FAIL summary"
}
