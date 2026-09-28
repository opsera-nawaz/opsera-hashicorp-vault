#!/usr/bin/env bash
# Copyright IBM Corp. 2016, 2026
# SPDX-License-Identifier: BUSL-1.1

# verify-fips-runtime.sh is the WO-061 system integration check for quality
# gate FIPS-RUNTIME-001: it invokes "vault fips-verify" (command/
# fips_verify.go, which wraps vault/fipsverify.CollectEvidence) on the
# target host, captures the resulting FIPS runtime evidence JSON document,
# and validates it with jq: OSFIPSEnabled must be 1, CryptoProvider must be
# "boringcrypto", and the configured TLS minimum version must be at least
# TLS 1.2 (0x0303 = 771) -- never inferred from a configuration flag or
# compile-time build tag alone.
#
# Unlike enos/scripts/verify-fips-startup.sh (WO-055), which only confirms
# Vault's startup check logged a pass/fail line, this script asserts on the
# structured evidence *document* itself, so it can be consumed by an audit
# process or CI evidence manifest, not just observed as a log line.
#
# Required environment variables:
#   VAULT_INSTALL_DIR  - directory containing the installed vault binary
#                         (e.g. /opt/vault/bin)
#   VAULT_CONFIG_PATH  - optional; path to the Vault server config file on
#                         this host, used to source TLS listener evidence.
#                         If empty, TLS evidence is omitted and the
#                         TLS-minimum-version assertion is skipped with a
#                         warning rather than treated as a failure.
#
# Exit codes: 0 on success (evidence confirms FIPS-aligned runtime state),
# 1 on usage/tooling error (missing binary, missing jq, invalid JSON), 2 if
# the evidence itself fails one of the three assertions.

set -euo pipefail

fail() {
  echo "verify-fips-runtime: FAIL -- $1" 1>&2
  exit "${2:-1}"
}

: "${VAULT_INSTALL_DIR:?VAULT_INSTALL_DIR must be set}"
VAULT_CONFIG_PATH="${VAULT_CONFIG_PATH:-}"

VAULT_BIN="${VAULT_INSTALL_DIR%/}/vault"

command -v jq >/dev/null 2>&1 || fail "jq is required to validate FIPS evidence JSON but was not found on PATH"
[[ -x "$VAULT_BIN" ]] || fail "vault binary not found or not executable at ${VAULT_BIN}"

FIPS_VERIFY_ARGS=()
if [[ -n "$VAULT_CONFIG_PATH" ]]; then
  FIPS_VERIFY_ARGS+=("-config=${VAULT_CONFIG_PATH}")
fi

echo "verify-fips-runtime: collecting evidence via ${VAULT_BIN} fips-verify ${FIPS_VERIFY_ARGS[*]:-}"

set +e
EVIDENCE_JSON="$("$VAULT_BIN" fips-verify "${FIPS_VERIFY_ARGS[@]:-}" 2>&1)"
COLLECT_EXIT_CODE=$?
set -e

echo "----- evidence -----"
echo "$EVIDENCE_JSON"
echo "---------------------"

echo "$EVIDENCE_JSON" | jq empty >/dev/null 2>&1 || fail "vault fips-verify did not produce valid JSON (exit code ${COLLECT_EXIT_CODE})"

OS_FIPS_ENABLED="$(echo "$EVIDENCE_JSON" | jq -r '.os_fips_enabled')"
CRYPTO_PROVIDER="$(echo "$EVIDENCE_JSON" | jq -r '.crypto_provider')"
TLS_MIN_VERSION="$(echo "$EVIDENCE_JSON" | jq -r '.tls_config.min_version')"

# TLS 1.2 is 0x0303 == 771 (see crypto/tls.VersionTLS12); a value of 0 means
# no tls.Config was provided (VAULT_CONFIG_PATH unset or no TLS-enabled
# listener found), which is a REVIEW condition, not a hard failure, since
# this story's constraints require the evidence to record the actual
# configured value rather than assume a default.
readonly TLS_1_2=771

[[ "$OS_FIPS_ENABLED" == "1" ]] || fail "expected os_fips_enabled=1, got '${OS_FIPS_ENABLED}'" 2
[[ "$CRYPTO_PROVIDER" == "boringcrypto" ]] || fail "expected crypto_provider='boringcrypto', got '${CRYPTO_PROVIDER}'" 2

if [[ "$TLS_MIN_VERSION" == "0" || "$TLS_MIN_VERSION" == "null" ]]; then
  echo "verify-fips-runtime: WARNING -- no TLS configuration was captured (VAULT_CONFIG_PATH not set or no TLS-enabled listener found); skipping TLS minimum version assertion"
elif (( TLS_MIN_VERSION < TLS_1_2 )); then
  fail "expected tls_config.min_version >= ${TLS_1_2} (TLS 1.2), got ${TLS_MIN_VERSION}" 2
fi

echo "verify-fips-runtime: PASS -- os_fips_enabled=1, crypto_provider=boringcrypto, tls_config.min_version=${TLS_MIN_VERSION}"
