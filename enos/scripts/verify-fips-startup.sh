#!/usr/bin/env bash
# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

# verify-fips-startup.sh is the WO-055 system integration smoke test for
# quality gates FIPS-RUNTIME-001 / FIPS-CONTAINER-001: it starts a
# fips-tagged Vault binary inside the FIPS-path UBI container (WO-046,
# Dockerfile `ubi` target) and confirms vault/fips_check.go's startup
# verification behaves correctly for the host it is run on.
#
# Behavior depends on the host's own OS-level FIPS state, since the
# container shares the host kernel's /proc:
#   - FIPS-enabled host (/proc/sys/crypto/fips_enabled == 1): the container
#     must start and log the exact success line from vault/fips_check.go,
#     "FIPS mode verified: OS-level FIPS enabled, OpenSSL FIPS provider
#     active" (AC1). This is the scenario an Enos-provisioned FIPS-enabled
#     runner (see WO-060) exercises in CI.
#   - non-FIPS host: the container must exit non-zero and log the FATAL
#     message from vault/fips_check.go, "OS-level FIPS mode not enabled on
#     this host..." (AC2). This is the negative-path anti-pattern check
#     (FIPS-capable image on a non-FIPS host must not silently succeed) and
#     is what most CI runners and developer workstations will exercise.
#
# The script auto-detects which of the two outcomes to expect from the
# host's own /proc/sys/crypto/fips_enabled and fails loudly if the
# container's behavior doesn't match, so it is safe to run in both
# environments without manual flags.
#
# Usage:
#   verify-fips-startup.sh --image <vault-fips-image-tag>
#
# Exit codes: 0 on success (container behaved correctly for this host's
# FIPS state), 1 on usage error, 2 if the container's behavior didn't match
# what this host's FIPS state predicts.

set -euo pipefail

fail() {
  echo "$1" 1>&2
  exit 1
}

IMAGE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)
      IMAGE="$2"
      shift 2
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[[ -n "$IMAGE" ]] || fail "usage: verify-fips-startup.sh --image <vault-fips-image-tag>"

SUCCESS_MESSAGE="FIPS mode verified: OS-level FIPS enabled, OpenSSL FIPS provider active"
FAILURE_MESSAGE="OS-level FIPS mode not enabled on this host"

host_fips_enabled=0
if [[ -r /proc/sys/crypto/fips_enabled ]] && [[ "$(tr -d '[:space:]' < /proc/sys/crypto/fips_enabled)" == "1" ]]; then
  host_fips_enabled=1
fi

echo "verify-fips-startup: host FIPS state: /proc/sys/crypto/fips_enabled enabled=${host_fips_enabled}"

# -dev mode is sufficient here: vault/fips_check.go's verifyFIPSMode runs
# inside CreateCore before any seal/barrier/storage work, so it gates
# startup identically regardless of storage backend.
set +e
CONTAINER_OUTPUT="$(docker run --rm --entrypoint /bin/vault "$IMAGE" server -dev -dev-listen-address=0.0.0.0:8200 2>&1)"
CONTAINER_EXIT_CODE=$?
set -e

echo "----- container output -----"
echo "$CONTAINER_OUTPUT"
echo "-----------------------------"
echo "verify-fips-startup: container exit code: ${CONTAINER_EXIT_CODE}"

if [[ "$host_fips_enabled" == "1" ]]; then
  [[ "$CONTAINER_EXIT_CODE" == "0" ]] || fail "expected the container to start successfully on a FIPS-enabled host, but it exited ${CONTAINER_EXIT_CODE}"
  echo "$CONTAINER_OUTPUT" | grep -qF "$SUCCESS_MESSAGE" || fail "expected success log line '${SUCCESS_MESSAGE}' not found in container output"
  echo "verify-fips-startup: PASS -- FIPS-enabled host, success log line confirmed"
else
  [[ "$CONTAINER_EXIT_CODE" != "0" ]] || fail "expected the container to fail closed on a non-FIPS host, but it exited 0"
  echo "$CONTAINER_OUTPUT" | grep -qF "$FAILURE_MESSAGE" || fail "expected FATAL log line containing '${FAILURE_MESSAGE}' not found in container output"
  echo "verify-fips-startup: PASS -- non-FIPS host correctly rejected (fail-closed) with the expected FATAL message"
fi
