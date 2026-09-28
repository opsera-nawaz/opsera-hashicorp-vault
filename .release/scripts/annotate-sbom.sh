#!/usr/bin/env bash
# Copyright IBM Corp. 2016, 2026
# SPDX-License-Identifier: BUSL-1.1

# annotate-sbom.sh post-processes the SBOM produced upstream by the
# crt-generate-sbom CRT event (.release/ci.hcl, which delegates to
# hashicorp/security-generate-release-sbom) with FIPS 140-3 cryptographic
# dependency annotations, and generates a build provenance attestation
# linking the source commit to the resulting binary artifact.
#
# It requires the `pipeline` CLI (tools/pipeline) to already be built and on
# PATH -- see `make tools-pipeline` / .github/actions/set-up-pipeline.
#
# Usage:
#   annotate-sbom.sh <version> [base-sbom-path] [binary-path]
#
# NOTE: the exact output path convention used by
# hashicorp/security-generate-release-sbom is defined in a private HashiCorp
# repository that isn't visible from this codebase, so BASE_SBOM_PATH below
# is a documented, overridable assumption -- override it with the second
# positional argument (or SBOM_INPUT_PATH) if the real convention differs.

set -euo pipefail

repo_root() {
  git rev-parse --show-toplevel
}

main() {
  local version base_sbom_path binary_path repo_dir
  version="${1:?usage: annotate-sbom.sh <version> [base-sbom-path] [binary-path]}"
  repo_dir="$(repo_root)"
  base_sbom_path="${2:-${SBOM_INPUT_PATH:-${repo_dir}/.release/sbom/${version}-sbom.json}}"
  binary_path="${3:-${repo_dir}/dist/vault}"

  local sbom_out_dir="${repo_dir}/.release/sbom"
  local provenance_out_dir="${repo_dir}/.release/provenance"
  local inventory_path="${repo_dir}/.release/fips-data/crypto-inventory.json"
  local annotated_sbom_path="${sbom_out_dir}/${version}-annotated-sbom.json"
  local provenance_path="${provenance_out_dir}/${version}-provenance.json"

  mkdir -p "$sbom_out_dir" "$provenance_out_dir"

  if ! command -v pipeline >/dev/null 2>&1; then
    echo "annotate-sbom.sh: 'pipeline' CLI not found on PATH; run 'make tools-pipeline' first" >&2
    exit 1
  fi

  if [ ! -f "$base_sbom_path" ]; then
    echo "annotate-sbom.sh: base sbom not found at ${base_sbom_path}" >&2
    echo "annotate-sbom.sh: override the path with the second positional argument or SBOM_INPUT_PATH" >&2
    exit 1
  fi

  echo "--> Annotating SBOM ${base_sbom_path} with FIPS crypto metadata from ${inventory_path}"
  pipeline sbom annotate \
    --sbom "$base_sbom_path" \
    --inventory "$inventory_path" \
    --output "$annotated_sbom_path"
  echo "--> Annotated SBOM written to ${annotated_sbom_path}"

  echo "--> Generating build provenance attestation for ${binary_path}"
  pipeline sbom provenance \
    --binary "$binary_path" \
    --go-version-file "${repo_dir}/.go-version" \
    --output "$provenance_path"
  echo "--> Provenance attestation written to ${provenance_path}"
}

main "$@"
