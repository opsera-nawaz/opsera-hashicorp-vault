#!/usr/bin/env bash
# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

# compare-benchmarks.sh computes WO-053's automated pass/fail regression
# check. It reads two JSON snapshots -- a baseline (pre-modernization) and a
# latest (post-change) capture, both in the "endpoints" + "unseal_time_seconds"
# schema produced by enos/k6/perf-regression.js's handleSummary() and
# enos/scripts/measure-unseal-time.sh -- and asserts:
#
#   * p99 latency for every endpoint is within 5% of its baseline
#     (quality.vault_api_p99_latency_regression)
#   * unseal_time_seconds is within 10% of its baseline
#     (quality.vault_unseal_time_regression)
#
# Usage:
#   compare-benchmarks.sh <baseline.json> <latest.json> [report_output.json]
#
# Exit codes: 0 if every metric is within threshold, 1 if any metric exceeds
# its threshold, 2 on usage/input error. The comparison report (per-metric
# baseline, current, pct change, threshold, pass/fail) is always printed to
# stdout as formatted text, and additionally written as JSON to
# report_output.json when that argument is given (or enos/benchmarks/latest.json's
# sibling "comparison-report.json" if omitted but latest.json is under
# enos/benchmarks/).

set -euo pipefail

fail_usage() {
  echo "$1" 1>&2
  echo "usage: $0 <baseline.json> <latest.json> [report_output.json]" 1>&2
  exit 2
}

[[ $# -lt 2 ]] && fail_usage "baseline.json and latest.json are required"

BASELINE_PATH="$1"
LATEST_PATH="$2"
REPORT_PATH="${3:-}"

[[ -f "${BASELINE_PATH}" ]] || fail_usage "baseline file not found: ${BASELINE_PATH}"
[[ -f "${LATEST_PATH}" ]] || fail_usage "latest file not found: ${LATEST_PATH}"

command -v jq > /dev/null || fail_usage "jq is required but not found on PATH"
command -v bc > /dev/null || fail_usage "bc is required but not found on PATH"

LATENCY_THRESHOLD_MULTIPLIER=1.05  # AC3: p99 latency must stay within 5% of baseline
UNSEAL_THRESHOLD_MULTIPLIER=1.10   # AC3: unseal time must stay within 10% of baseline

ENDPOINTS=(sys_health kv_write kv_read transit_encrypt)

overall_status=0
rows_json="[]"

pct_change() {
  # $1=baseline $2=current -> signed percentage change, current relative to baseline
  local baseline="$1" current="$2"
  if [[ "${baseline}" == "0" || "${baseline}" == "null" ]]; then
    echo "0"
    return
  fi
  echo "scale=4; ((${current} - ${baseline}) / ${baseline}) * 100" | bc
}

exceeds_threshold() {
  # $1=baseline $2=current $3=multiplier -> "1" if current > baseline * multiplier
  local baseline="$1" current="$2" multiplier="$3"
  local limit
  limit=$(echo "scale=6; ${baseline} * ${multiplier}" | bc)
  (( $(echo "${current} > ${limit}" | bc -l) )) && echo 1 || echo 0
}

evaluate_metric() {
  local name="$1" baseline="$2" current="$3" multiplier="$4" unit="$5"

  if [[ "${baseline}" == "null" || "${current}" == "null" ]]; then
    echo "  ${name}: CANNOT_VERIFY (missing baseline or current value)"
    rows_json=$(echo "${rows_json}" | jq --arg name "${name}" \
      '. + [{"metric":$name,"status":"CANNOT_VERIFY"}]')
    return
  fi

  local change
  change=$(pct_change "${baseline}" "${current}")
  local breach
  breach=$(exceeds_threshold "${baseline}" "${current}" "${multiplier}")
  local status="PASS"
  if [[ "${breach}" == "1" ]]; then
    status="FAIL"
    overall_status=1
  fi

  printf '  %-28s baseline=%-10s current=%-10s change=%+.2f%%  threshold=+%.0f%%  [%s]\n' \
    "${name}" "${baseline}${unit}" "${current}${unit}" "${change}" \
    "$(echo "(${multiplier} - 1) * 100" | bc)" "${status}"

  rows_json=$(echo "${rows_json}" | jq \
    --arg name "${name}" \
    --arg baseline "${baseline}" \
    --arg current "${current}" \
    --arg change "${change}" \
    --arg multiplier "${multiplier}" \
    --arg status "${status}" \
    '. + [{"metric":$name,"baseline":($baseline|tonumber),"current":($current|tonumber),"pct_change":($change|tonumber),"threshold_multiplier":($multiplier|tonumber),"status":$status}]')
}

echo "WO-053 performance regression comparison"
echo "  baseline: ${BASELINE_PATH}"
echo "  latest:   ${LATEST_PATH}"
echo ""
echo "p99 latency (ms), threshold +5%:"

for ep in "${ENDPOINTS[@]}"; do
  baseline_val=$(jq -r ".endpoints.${ep}.p99_ms // \"null\"" "${BASELINE_PATH}")
  current_val=$(jq -r ".endpoints.${ep}.p99_ms // \"null\"" "${LATEST_PATH}")
  evaluate_metric "${ep}_p99" "${baseline_val}" "${current_val}" "${LATENCY_THRESHOLD_MULTIPLIER}" "ms"
done

echo ""
echo "unseal time (seconds), threshold +10%:"
baseline_unseal=$(jq -r ".unseal_time_seconds // \"null\"" "${BASELINE_PATH}")
current_unseal=$(jq -r ".unseal_time_seconds // \"null\"" "${LATEST_PATH}")
evaluate_metric "unseal_time" "${baseline_unseal}" "${current_unseal}" "${UNSEAL_THRESHOLD_MULTIPLIER}" "s"

echo ""
if [[ "${overall_status}" -eq 0 ]]; then
  echo "RESULT: PASS -- all metrics within threshold"
else
  echo "RESULT: FAIL -- one or more metrics exceeded their regression threshold"
fi

if [[ -n "${REPORT_PATH}" ]]; then
  jq -n --argjson rows "${rows_json}" \
    --arg baseline_path "${BASELINE_PATH}" \
    --arg latest_path "${LATEST_PATH}" \
    --arg overall "$([[ ${overall_status} -eq 0 ]] && echo PASS || echo FAIL)" \
    '{baseline_path:$baseline_path, latest_path:$latest_path, overall_status:$overall, metrics:$rows}' \
    > "${REPORT_PATH}"
  echo ""
  echo "comparison report written to ${REPORT_PATH}"
fi

exit "${overall_status}"
