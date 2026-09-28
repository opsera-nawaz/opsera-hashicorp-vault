// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: BUSL-1.1

scenario "fips_startup" {
  description = <<-EOF
    The fips_startup scenario is the WO-055 system integration check for
    quality gates FIPS-RUNTIME-001 / FIPS-CONTAINER-001: it builds a
    fips-tagged Vault binary from the local branch, builds the FIPS-path
    UBI container image (WO-046, Dockerfile `ubi` target), and confirms
    Vault's startup FIPS mode verification (vault/fips_check.go) behaves
    correctly for whichever host runs this scenario:

      - on a FIPS-enabled host (/proc/sys/crypto/fips_enabled == 1, e.g. an
        Enos-provisioned FIPS runner, see WO-060): the container must start
        and log "FIPS mode verified: OS-level FIPS enabled, OpenSSL FIPS
        provider active".
      - on any other host (most CI runners and developer workstations):
        the container must exit non-zero and log the FATAL "OS-level FIPS
        mode not enabled on this host..." message -- the fail-closed
        anti-pattern check this story exists to add.

    This scenario is entirely local (it only requires Docker and a Go
    toolchain) and does not provision any cloud infrastructure.

    Building the fips-tagged binary requires cgo (see
    helper/constants/fips_cgo_check.go), so this scenario must run on a
    Linux amd64/arm64 host -- see
    enos/modules/verify_fips_startup/scripts/build-and-verify.sh for how
    to reproduce the same build from a macOS development machine.
  EOF

  terraform_cli = terraform_cli.default
  terraform     = terraform.default

  providers = [
    provider.enos.default,
  ]

  step "get_local_metadata" {
    description = "Read the local branch's version and git revision, used to tag the FIPS-path image"
    module      = module.get_local_metadata
  }

  step "verify_fips_startup" {
    description = "Build the fips-tagged binary and FIPS-path UBI image, then verify Vault's startup FIPS mode check"
    module      = module.verify_fips_startup
    depends_on  = [step.get_local_metadata]

    variables {
      image_tag        = "vault:${step.get_local_metadata.version}-fips-startup-check"
      product_version  = step.get_local_metadata.version
      product_revision = step.get_local_metadata.revision
    }
  }
}
