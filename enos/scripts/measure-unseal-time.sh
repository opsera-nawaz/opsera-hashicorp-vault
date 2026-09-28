#!/usr/bin/env bash
# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

# measure-unseal-time.sh instruments the WO-053 unseal-time metric: the wall
# clock time between submitting the final unseal key share (manual/Shamir
# path) -- or, for auto-unseal, the moment the node is expected to begin
# unsealing itself -- and GET /v1/sys/health first returning 200. It polls
# health every 500ms, per WO-053's technical_details.
#
# Usage:
#   measure-unseal-time.sh --addr <vault_addr> --key <base64_unseal_key> [--insecure] [--timeout <secs>]
#   measure-unseal-time.sh --addr <vault_addr> --auto-unseal [--insecure] [--timeout <secs>]
#
# Output (stdout): a single JSON object, e.g.
#   {"unseal_time_seconds":1.87,"seal_type":"shamir","vault_addr":"https://127.0.0.1:8200","measured_at":"2026-09-28T03:20:00Z"}
#
# Exit codes: 0 on success, 1 on usage error, 2 on timeout waiting for health.

set -euo pipefail

fail() {
  echo "$1" 1>&2
  exit 1
}

VAULT_ADDR=""
UNSEAL_KEY=""
AUTO_UNSEAL=0
INSECURE=0
POLL_INTERVAL_SECONDS=0.5
TIMEOUT_SECONDS=120

while [[ $# -gt 0 ]]; do
  case "$1" in
    --addr)
      VAULT_ADDR="$2"
      shift 2
      ;;
    --key)
      UNSEAL_KEY="$2"
      shift 2
      ;;
    --auto-unseal)
      AUTO_UNSEAL=1
      shift
      ;;
    --insecure)
      INSECURE=1
      shift
      ;;
    --timeout)
      TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    *)
      fail "unrecognized argument: $1"
      ;;
  esac
done

[[ -z "${VAULT_ADDR}" ]] && fail "--addr is required"
if [[ "${AUTO_UNSEAL}" -eq 0 && -z "${UNSEAL_KEY}" ]]; then
  fail "--key is required unless --auto-unseal is set"
fi

CURL_OPTS=(-s -o /dev/null -w '%{http_code}')
[[ "${INSECURE}" -eq 1 ]] && CURL_OPTS+=(-k)

health_code() {
  # standbyok=true: a node that has unsealed and rejoined as a standby (its
  # peer kept leadership while it was sealed) is just as "ready to serve
  # traffic" from an operator's perspective as an active node -- this
  # matches how load balancers health-check Vault in production. Without
  # this, measuring unseal time on any node other than the active leader
  # would never observe a 200 and would always time out.
  curl "${CURL_OPTS[@]}" "${VAULT_ADDR}/v1/sys/health?standbyok=true" || echo "000"
}

seal_type="shamir"
start_epoch=""
start_iso=""

if [[ "${AUTO_UNSEAL}" -eq 1 ]]; then
  seal_type="auto"
  # The node auto-unseals on its own after start; there is no key-share
  # submission to time from, so the clock starts now (the moment this
  # script is invoked, which callers must run immediately after the node
  # process starts, per WO-053 edge_cases on auto-unseal timing).
  start_epoch=$(date +%s.%N)
  start_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
else
  UNSEAL_CURL_OPTS=(-s -X PUT -H 'Content-Type: application/json' -d "{\"key\":\"${UNSEAL_KEY}\"}")
  [[ "${INSECURE}" -eq 1 ]] && UNSEAL_CURL_OPTS+=(-k)

  start_epoch=$(date +%s.%N)
  start_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  curl "${UNSEAL_CURL_OPTS[@]}" "${VAULT_ADDR}/v1/sys/unseal" > /dev/null
fi

end_epoch=""
deadline=$(echo "${start_epoch} + ${TIMEOUT_SECONDS}" | bc)

while true; do
  now=$(date +%s.%N)
  if (( $(echo "${now} > ${deadline}" | bc -l) )); then
    echo "timed out after ${TIMEOUT_SECONDS}s waiting for ${VAULT_ADDR}/v1/sys/health to return 200" 1>&2
    exit 2
  fi

  code=$(health_code)
  if [[ "${code}" == "200" ]]; then
    end_epoch=$(date +%s.%N)
    break
  fi

  sleep "${POLL_INTERVAL_SECONDS}"
done

duration=$(echo "${end_epoch} - ${start_epoch}" | bc)
duration_rounded=$(printf '%.3f' "${duration}")

printf '{"unseal_time_seconds":%s,"seal_type":"%s","vault_addr":"%s","measured_at":"%s"}\n' \
  "${duration_rounded}" "${seal_type}" "${VAULT_ADDR}" "${start_iso}"
