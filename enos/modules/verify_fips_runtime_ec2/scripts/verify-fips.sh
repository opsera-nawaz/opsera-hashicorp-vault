#!/usr/bin/env bash
# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1
#
# verify-fips.sh is the enos_remote_exec / enos_local_exec verification
# script for the verify_fips_runtime module (WO-060). It reports a
# FIPS-aligned-posture PASS/FAIL/SKIP result for up to three independent
# checks. This script never claims Vault -- or the host it runs on -- is
# "FIPS certified" or "FIPS validated"; it reports only the raw,
# re-verifiable observations below.
#
# Checks:
#   1. OS-level FIPS mode      -- cat /proc/sys/crypto/fips_enabled
#   2. OpenSSL FIPS provider   -- openssl list -providers
#   3. Vault TLS negotiation   -- openssl s_client against $VAULT_ADDR,
#      restricted to the Approved cipher suite allowlist
#
# Environment variables:
#   REQUIRE_OS_FIPS     - "true" (default) to hard-fail checks 1 and 2 when
#                         the host isn't FIPS-enabled; "false" to run them
#                         informationally only (e.g. when invoked locally
#                         against a non-FIPS Enos runner for check 3 only).
#   VAULT_ADDR          - e.g. http://127.0.0.1:8200. Check 3 is skipped
#                         entirely when this is unset/empty.
#   ALLOWED_TLS_CIPHERS - space-separated allowlist, e.g.
#                         "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384 TLS_AES_256_GCM_SHA384"

set -uo pipefail

REQUIRE_OS_FIPS="${REQUIRE_OS_FIPS:-true}"
VAULT_ADDR="${VAULT_ADDR:-}"
ALLOWED_TLS_CIPHERS="${ALLOWED_TLS_CIPHERS:-TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384 TLS_AES_256_GCM_SHA384 TLS_AES_128_GCM_SHA256}"

overall_status=0

echo "=== verify-fips.sh: check 1/3 - OS-level FIPS mode ==="
fips_enabled="$(cat /proc/sys/crypto/fips_enabled 2>/dev/null || echo "unavailable")"
echo "/proc/sys/crypto/fips_enabled=${fips_enabled}"
if [ "$REQUIRE_OS_FIPS" = "true" ]; then
  if [ "$fips_enabled" = "1" ]; then
    echo "PASS: OS-level FIPS mode is enabled"
  else
    echo "FAIL: OS-level FIPS mode is not enabled (fips_enabled=${fips_enabled})"
    overall_status=1
  fi
else
  echo "SKIP: REQUIRE_OS_FIPS=false, not asserting on this host"
fi

echo "=== verify-fips.sh: check 2/3 - OpenSSL FIPS provider ==="
if command -v openssl >/dev/null 2>&1; then
  providers_output="$(openssl list -providers 2>&1 || true)"
  echo "$providers_output"
  if [ "$REQUIRE_OS_FIPS" = "true" ]; then
    if echo "$providers_output" | grep -A2 -i "^  *fips" | grep -qi "status: active"; then
      echo "PASS: OpenSSL FIPS provider is active"
    else
      echo "FAIL: OpenSSL FIPS provider is not active"
      overall_status=1
    fi
  else
    echo "SKIP: REQUIRE_OS_FIPS=false, not asserting on this host"
  fi
else
  echo "FAIL: openssl binary not found"
  if [ "$REQUIRE_OS_FIPS" = "true" ]; then
    overall_status=1
  fi
fi

echo "=== verify-fips.sh: check 3/3 - Vault TLS negotiation ==="
if [ -z "$VAULT_ADDR" ]; then
  echo "SKIP: VAULT_ADDR not set"
else
  target="$(echo "$VAULT_ADDR" | sed -E 's#^[a-zA-Z]+://##; s#/.*$##')"
  host="${target%%:*}"
  port="${target##*:}"
  if [ "$port" = "$host" ]; then
    port=8200
  fi

  negotiated="$(echo | timeout 10 openssl s_client -connect "${host}:${port}" -tls1_2 2>/dev/null | grep -i "Cipher" | head -1 || true)"
  echo "negotiated: ${negotiated}"

  matched=0
  for cipher in $ALLOWED_TLS_CIPHERS; do
    if echo "$negotiated" | grep -qi "$cipher"; then
      matched=1
      break
    fi
  done

  if [ "$matched" -eq 1 ]; then
    echo "PASS: negotiated TLS cipher is on the Approved allowlist"
  else
    echo "FAIL: negotiated TLS cipher is not on the Approved allowlist (${ALLOWED_TLS_CIPHERS})"
    overall_status=1
  fi
fi

if [ "$overall_status" -eq 0 ]; then
  echo "=== verify-fips.sh: overall result: PASS ==="
else
  echo "=== verify-fips.sh: overall result: FAIL ==="
fi
exit "$overall_status"
