#!/usr/bin/env bash
# Copyright IBM Corp. 2016, 2026
# SPDX-License-Identifier: BUSL-1.1

# generate-fips-evidence.sh assembles the dated FIPS 140-3 evidence package
# for a release: CMVP certificate references
# (.release/fips-data/cmvp-certificates.json), a TLS listener configuration
# snapshot extracted from the Vault server config template, exception
# records consumed from the exception tracking system, and references to
# the release's annotated SBOM (crt-generate-sbom / fips-annotate-sbom CRT
# events), build provenance attestation, and the residual crypto risk
# register. The output is written to
# .release/fips-evidence/<date>-fips-evidence.json.
#
# It requires the `pipeline` CLI (tools/pipeline) to already be built and on
# PATH -- see `make tools-pipeline` / .github/actions/set-up-pipeline.
#
# Usage:
#   generate-fips-evidence.sh <version> [date]
#
# <date> defaults to the current UTC timestamp in compact ISO 8601 form
# (YYYYMMDDThhmmssZ) so that multiple releases on the same calendar day
# never overwrite one another's evidence package.

set -euo pipefail

repo_root() {
  git rev-parse --show-toplevel
}

main() {
  local version date repo_dir
  version="${1:?usage: generate-fips-evidence.sh <version> [date]}"
  date="${2:-$(date -u +%Y%m%dT%H%M%SZ)}"
  repo_dir="$(repo_root)"

  local evidence_out_dir="${repo_dir}/.release/fips-evidence"
  local output_path="${evidence_out_dir}/${date}-fips-evidence.json"

  mkdir -p "$evidence_out_dir"

  if ! command -v pipeline >/dev/null 2>&1; then
    echo "generate-fips-evidence.sh: 'pipeline' CLI not found on PATH; run 'make tools-pipeline' first" >&2
    exit 1
  fi

  echo "--> Assembling FIPS evidence package for release ${version}"
  pipeline fips evidence \
    --release-version "$version" \
    --output "$output_path"
  echo "--> FIPS evidence package written to ${output_path}"
}

main "$@"
