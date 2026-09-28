# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

schema = "2"

project "vault" {
  team = "vault"
  slack {
    notification_channel = "C09LD1XT5MX" // #feed-vault-releases
  }
  github {
    organization = "hashicorp"
    repository = "vault"
    release_branches = [
      "main",
      "release/**",
    ]
  }
}

event "merge" {
  // "entrypoint" to use if build is not run automatically
  // i.e. send "merge" complete signal to orchestrator to trigger build
}

event "build" {
  depends = ["merge"]
  action "build" {
    organization = "hashicorp"
    repository = "vault"
    workflow = "build"
  }
}

event "prepare" {
  depends = ["build"]
  action "prepare" {
    organization = "hashicorp"
    repository   = "crt-workflows-common"
    workflow     = "prepare"
    depends      = ["build"]
  }

  notification {
    on = "fail"
  }
}

event "enos-release-testing-oss" {
  depends = ["prepare"]
  action "enos-release-testing-oss" {
    organization = "hashicorp"
    repository = "vault"
    workflow = "enos-release-testing-oss"
  }

  notification {
    on = "fail"
  }
}

## These events are publish and post-publish events and should be added to the end of the file
## after the verify event stanza.

event "trigger-staging" {
  // This event is dispatched by the bob trigger-promotion command
  // and is required - do not delete.
}

event "promote-staging" {
  depends = ["trigger-staging"]
  action "promote-staging" {
    organization = "hashicorp"
    repository = "crt-workflows-common"
    workflow = "promote-staging"
    config = "release-metadata.hcl"
  }

  notification {
    on = "always"
  }
}

event "trigger-production" {
  // This event is dispatched by the bob trigger-promotion command
  // and is required - do not delete.
}

event "promote-production" {
  depends = ["trigger-production"]
  action "promote-production" {
    organization = "hashicorp"
    repository = "crt-workflows-common"
    workflow = "promote-production"
  }

  promotion-events {
    update-ironbank = true
    bump-version-patch = true
    post-publish-website = true
  }

  notification {
    on = "always"
  }
}

event "crt-generate-sbom" {
  depends = ["promote-production"]
  action "crt-generate-sbom" {
	organization = "hashicorp"
	repository = "security-generate-release-sbom"
	workflow = "crt-generate-sbom"
  }

  notification {
	on = "fail"
  }
}

# fips-annotate-sbom is a post-processing step that runs after
# crt-generate-sbom. It annotates the generated SBOM with FIPS 140-3
# cryptographic dependency metadata (.release/fips-data/crypto-inventory.json,
# sourced from the Phase 1 crypto inventory) and produces a build provenance
# attestation, via .release/scripts/annotate-sbom.sh (which shells out to the
# `pipeline sbom annotate` / `pipeline sbom provenance` commands implemented
# in tools/pipeline/internal/cmd/annotate_sbom.go and generate_provenance.go).
#
# The underlying GitHub Actions workflow this action delegates to is owned by
# the CI-enforcement work (FIPS Phase 4 CI gates) and is intentionally out of
# scope for this story -- see the epic's CI enforcement stories.
event "fips-annotate-sbom" {
  depends = ["crt-generate-sbom"]
  action "fips-annotate-sbom" {
	organization = "hashicorp"
	repository = "vault"
	workflow = "fips-annotate-sbom"
  }

  notification {
	on = "fail"
  }
}

# crt-generate-fips-evidence assembles the dated FIPS 140-3 evidence package
# required by FIPS-RUNTIME-001: CMVP certificate references
# (.release/fips-data/cmvp-certificates.json), a TLS listener configuration
# snapshot, algorithm-restriction verification results, exception records
# consumed from the exception tracking system (FIPS Phase 4 CI enforcement
# work), and references to the risk register, annotated SBOM, and build
# provenance attestation produced by fips-annotate-sbom above. It runs via
# .release/scripts/generate-fips-evidence.sh (which shells out to the
# `pipeline fips evidence` command implemented in
# tools/pipeline/internal/cmd/generate_fips_evidence.go) and writes a dated,
# version-controlled JSON artifact to .release/fips-evidence/.
#
# The underlying GitHub Actions workflow this action delegates to is owned by
# the CI-enforcement work (FIPS Phase 4 CI gates) and is intentionally out of
# scope for this story -- see the epic's CI enforcement stories.
event "crt-generate-fips-evidence" {
  depends = ["crt-generate-sbom", "fips-annotate-sbom"]
  action "crt-generate-fips-evidence" {
	organization = "hashicorp"
	repository = "vault"
	workflow = "crt-generate-fips-evidence"
  }

  notification {
	on = "fail"
  }
}
