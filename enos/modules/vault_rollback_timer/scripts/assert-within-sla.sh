#!/usr/bin/env bash
# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

set -e

fail() {
  echo "$1" 1>&2
  exit 1
}

[[ -z "$ELAPSED_SECONDS" ]] && fail "ELAPSED_SECONDS env variable has not been set"
[[ -z "$SLA_SECONDS" ]] && fail "SLA_SECONDS env variable has not been set"

echo "WO-052 rollback wall-clock duration: ${ELAPSED_SECONDS}s (SLA: ${SLA_SECONDS}s)"

if [ "$ELAPSED_SECONDS" -ge "$SLA_SECONDS" ]; then
  fail "WO-052 AC6 FAILED: rollback exceeded the ${SLA_SECONDS}s recovery SLA (measured ${ELAPSED_SECONDS}s)"
fi

margin=$((SLA_SECONDS - ELAPSED_SECONDS))
echo "WO-052 AC6 PASSED: rollback completed within the ${SLA_SECONDS}s recovery SLA (measured ${ELAPSED_SECONDS}s, ${margin}s margin remaining)"
