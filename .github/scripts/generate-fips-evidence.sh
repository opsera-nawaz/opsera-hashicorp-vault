#!/usr/bin/env bash
# Copyright IBM Corp. 2016, 2026
# SPDX-License-Identifier: BUSL-1.1
#
# generate-fips-evidence.sh assembles a CMVP-reference evidence manifest (JSON)
# for a single FIPS-path CE CI build (WO-062): the Go toolchain version, the
# GOEXPERIMENT value, the build tags in effect, and -- when a FIPS-path
# container image is available to inspect -- its base OS and crypto library
# version. It is a lightweight per-build attestation produced by the
# test-go-fips-ce workflow and the build.yml fips-path-image-verify job.
#
# This is NOT the dated, multi-source evidence *package* produced by
# `pipeline fips evidence` (tools/pipeline/internal/cmd/fips_evidence.go,
# WO-057), which aggregates CMVP certificate references, exception records,
# SBOM, and build provenance for a release. This script only ever records
# placeholder CMVP certificate entries -- it does not claim "FIPS validated"
# or "FIPS certified" anywhere, since Vault's CMVP validation is pending
# (Phase 4); it reports the build as "FIPS-aligned" instead.
#
# Usage:
#   generate-fips-evidence.sh [--output FILE] [--container-image IMAGE]
#   generate-fips-evidence.sh --test
#
# Environment:
#   GOEXPERIMENT   Recorded as-is if set; otherwise queried via `go env GOEXPERIMENT`;
#                  otherwise recorded as "none" (a non-FIPS build has no GOEXPERIMENT set,
#                  and that is a valid, non-error state -- it must never cause a failure).
#   GOTAGS         Recorded as the manifest's build_tags field; "none" if unset/empty.
#   GITHUB_SHA     Recorded as source_commit if set; otherwise `git rev-parse HEAD`.
#
# Exits 0 in all normal cases -- missing GOEXPERIMENT or a missing/unbuilt container image are
# expected, gracefully-degraded states, not failures. Exits 1 only for a usage error.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# PSP-3913: the security-scan.hcl module/container scanners can't resolve the
# "+boringcrypto"-suffixed Go toolchain/vulnerability-database versions produced by a
# GOEXPERIMENT=boringcrypto build, so a fixed list of CVE IDs is suppressed there until the
# scanner supports the suffix. That is a known, tracked limitation -- surface it in the
# evidence manifest rather than silently omitting it (constraints: "must be acknowledged ...
# not silently ignored"). Also tracked as structured exception records in
# .release/fips-data/exceptions.json (WO-063).
readonly KNOWN_LIMITATION_PSP_3913='PSP-3913: .release/security-scan.hcl suppresses OSV/OSS-Index findings for BoringCrypto-suffixed toolchain/module versions (GO-2026-6091, GO-2026-6088, GO-2026-5972, GO-2026-6218, GO-2026-6090, GO-2026-5026, GO-2026-6089, GO-2026-5942) pending scanner support for the +boringcrypto version suffix; tracked as structured exceptions in .release/fips-data/exceptions.json.'

usage() {
  echo "Usage: $(basename "$0") [--output FILE] [--container-image IMAGE]" >&2
  echo "       $(basename "$0") --test" >&2
}

# go_version_str prints the Go toolchain version (e.g. "go1.25.4"), or "unknown" if the go
# binary isn't on PATH.
go_version_str() {
  if command -v go >/dev/null 2>&1; then
    go version | awk '{print $3}'
  else
    echo "unknown"
  fi
}

# goexperiment_str prints the effective GOEXPERIMENT value, falling back gracefully to "none"
# rather than failing when it's unset (edge_cases: "handle ... gracefully ... rather than
# failing").
goexperiment_str() {
  if [[ -n "${GOEXPERIMENT:-}" ]]; then
    echo "$GOEXPERIMENT"
    return
  fi
  if command -v go >/dev/null 2>&1; then
    local v
    v=$(go env GOEXPERIMENT 2>/dev/null || true)
    if [[ -n "$v" ]]; then
      echo "$v"
      return
    fi
  fi
  echo "none"
}

# container_metadata IMAGE prints "base_os<TAB>crypto_library" for IMAGE.
#
#   - IMAGE empty (no container was built in this CI stage, e.g. the Go-test-only
#     test-go-fips-ce workflow): "not-built-in-this-stage" for both fields.
#   - docker unavailable, or `docker image inspect` fails (image not loaded/present):
#     "unavailable" for both fields.
#   - Otherwise: the PRETTY_NAME from /etc/os-release and the `openssl version` output
#     observed inside the running container.
#
# Every path degrades gracefully rather than failing the script -- the pass/fail base-image
# check itself lives in the build.yml fips-path-image-verify step, not here.
container_metadata() {
  local image="$1"
  if [[ -z "$image" ]]; then
    printf 'not-built-in-this-stage\tnot-built-in-this-stage\n'
    return
  fi
  if ! command -v docker >/dev/null 2>&1 || ! docker image inspect "$image" >/dev/null 2>&1; then
    printf 'unavailable\tunavailable\n'
    return
  fi

  local os_release base_os crypto_lib
  os_release=$(docker run --rm --entrypoint sh "$image" -c 'cat /etc/os-release 2>/dev/null' 2>/dev/null || true)
  base_os=$(sed -n 's/^PRETTY_NAME="\(.*\)"$/\1/p' <<<"$os_release" | head -n1)
  [[ -z "$base_os" ]] && base_os="unknown"

  crypto_lib=$(docker run --rm --entrypoint sh "$image" -c 'openssl version 2>/dev/null' 2>/dev/null || true)
  [[ -z "$crypto_lib" ]] && crypto_lib="unknown"

  printf '%s\t%s\n' "$base_os" "$crypto_lib"
}

# build_manifest CONTAINER_IMAGE prints the evidence manifest JSON to stdout.
build_manifest() {
  local container_image="${1:-}"
  local go_ver goexp tags commit ts base_os crypto_lib

  go_ver=$(go_version_str)
  goexp=$(goexperiment_str)
  tags="${GOTAGS:-none}"
  [[ -z "$tags" ]] && tags="none"
  commit="${GITHUB_SHA:-}"
  if [[ -z "$commit" ]]; then
    commit=$(cd "$REPO_ROOT" && git rev-parse HEAD 2>/dev/null || echo unknown)
  fi
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  IFS=$'\t' read -r base_os crypto_lib <<<"$(container_metadata "$container_image")"

  jq -n \
    --arg go_version "$go_ver" \
    --arg goexperiment "$goexp" \
    --arg build_tags "$tags" \
    --arg container_base_os "$base_os" \
    --arg container_crypto_library "$crypto_lib" \
    --arg build_timestamp "$ts" \
    --arg source_commit "$commit" \
    --arg build_classification "FIPS-aligned build" \
    --arg known_limitation "$KNOWN_LIMITATION_PSP_3913" \
    '{
      go_version: $go_version,
      goexperiment: $goexperiment,
      build_tags: $build_tags,
      container_base_os: $container_base_os,
      container_crypto_library: $container_crypto_library,
      build_classification: $build_classification,
      cmvp_certificates: [
        {
          module_name: "Vault BoringCrypto FIPS 140-3 module",
          certificate_number: null,
          status: "pending_cmvp_submission"
        }
      ],
      known_limitations: [$known_limitation],
      build_timestamp: $build_timestamp,
      source_commit: $source_commit
    }'
}

run_test() {
  local rc=0 out

  echo "=== test 1: manifest is valid JSON with all required fields ==="
  out=$(build_manifest "")
  if ! jq -e . >/dev/null 2>&1 <<<"$out"; then
    echo "FAIL: manifest is not valid JSON"
    echo "$out"
    rc=1
  else
    local missing="" field
    for field in go_version goexperiment build_tags container_base_os container_crypto_library \
      cmvp_certificates build_timestamp source_commit build_classification known_limitations; do
      if ! jq -e --arg f "$field" 'has($f)' >/dev/null 2>&1 <<<"$out"; then
        missing="$missing $field"
      fi
    done
    if [[ -n "$missing" ]]; then
      echo "FAIL: manifest missing field(s):$missing"
      rc=1
    else
      echo "PASS: manifest is valid JSON with all required fields"
    fi
  fi

  echo
  echo "=== test 2: manifest never claims FIPS validated/certified ==="
  if grep -Eqi 'fips (validated|certified)' <<<"$out"; then
    echo "FAIL: manifest contains disallowed FIPS validated/certified language"
    rc=1
  else
    echo "PASS: no FIPS validated/certified language present"
  fi

  echo
  echo "=== test 3: empty GOEXPERIMENT degrades to 'none' rather than failing ==="
  local nonfips_out goexp_field
  nonfips_out=$(GOEXPERIMENT="" build_manifest "")
  goexp_field=$(jq -r .goexperiment <<<"$nonfips_out")
  if [[ -z "$goexp_field" ]]; then
    echo "FAIL: goexperiment field is empty rather than a fallback value"
    rc=1
  else
    echo "PASS: goexperiment resolved to '${goexp_field}' without failing"
  fi

  echo
  echo "=== test 4: missing/unavailable container image degrades gracefully ==="
  local missing_image_out base_os_field
  missing_image_out=$(build_manifest "definitely-not-a-real-image:does-not-exist")
  base_os_field=$(jq -r .container_base_os <<<"$missing_image_out")
  if [[ "$base_os_field" == "unavailable" || "$base_os_field" == "not-built-in-this-stage" ]]; then
    echo "PASS: unavailable container image handled gracefully (container_base_os=${base_os_field})"
  else
    echo "FAIL: expected graceful degradation for a missing container image, got container_base_os=${base_os_field}"
    rc=1
  fi

  echo
  echo "=== test 5: PSP-3913 BoringCrypto scanner limitation is acknowledged ==="
  if jq -e '.known_limitations[]' >/dev/null 2>&1 <<<"$out" && grep -q "PSP-3913" <<<"$out"; then
    echo "PASS: PSP-3913 known limitation present in manifest"
  else
    echo "FAIL: PSP-3913 known limitation missing from manifest"
    rc=1
  fi

  echo
  if [[ $rc -eq 0 ]]; then
    echo "All tests passed."
  else
    echo "One or more tests FAILED."
  fi
  return "$rc"
}

main() {
  local output="" container_image=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --output)
        output="${2:-}"
        shift 2
        ;;
      --container-image)
        container_image="${2:-}"
        shift 2
        ;;
      --test)
        run_test
        exit $?
        ;;
      --help | -h)
        usage
        exit 0
        ;;
      *)
        echo "unknown argument: $1" >&2
        usage
        exit 1
        ;;
    esac
  done

  local manifest
  manifest=$(build_manifest "$container_image")

  if [[ -n "$output" ]]; then
    printf '%s\n' "$manifest" >"$output"
    echo "FIPS evidence manifest written to $output" >&2
  else
    printf '%s\n' "$manifest"
  fi
}

main "$@"
