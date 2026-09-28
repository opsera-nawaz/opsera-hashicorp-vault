#!/usr/bin/env bash
# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

set -e

fail() {
  echo "$1" 1>&2
  exit 1
}

[[ -z "$START_EPOCH" ]] && fail "START_EPOCH env variable has not been set"
[[ -z "$SLA_SECONDS" ]] && fail "SLA_SECONDS env variable has not been set"

now_epoch=$(date +%s)
elapsed=$((now_epoch - START_EPOCH))

echo "WO-052 rollback wall-clock duration: ${elapsed}s (SLA: ${SLA_SECONDS}s)" 1>&2

if [ "$elapsed" -ge "$SLA_SECONDS" ]; then
  fail "WO-052 AC6 FAILED: rollback exceeded the ${SLA_SECONDS}s recovery SLA (measured ${elapsed}s)"
fi

margin=$((SLA_SECONDS - elapsed))
echo "WO-052 AC6 PASSED: rollback completed within the ${SLA_SECONDS}s recovery SLA (${margin}s margin remaining)" 1>&2

# Print only the number on stdout so callers can cleanly capture it as an output value.
echo "$elapsed"
