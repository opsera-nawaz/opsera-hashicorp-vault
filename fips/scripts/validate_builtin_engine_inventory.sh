#!/usr/bin/env bash
# Validates fips/inventory/*.yaml crypto inventory files against
# fips/schemas/builtin_engine_crypto_entry.json.
#
# Usage:
#   fips/scripts/validate_inventory_schema.sh [inventory.yaml ...]
#
# With no arguments, validates every fips/inventory/*.yaml file found
# relative to the repository root (detected via `git rev-parse`).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SCHEMA="${REPO_ROOT}/fips/schemas/builtin_engine_crypto_entry.json"

if [ ! -f "${SCHEMA}" ]; then
  echo "schema not found: ${SCHEMA}" >&2
  exit 1
fi

if [ "$#" -gt 0 ]; then
  FILES=("$@")
else
  FILES=("${REPO_ROOT}"/fips/inventory/builtin_logical_crypto_sites.yaml "${REPO_ROOT}"/fips/inventory/builtin_credential_crypto_sites.yaml)
fi

if [ ! -e "${FILES[0]}" ]; then
  echo "no inventory YAML files found under ${REPO_ROOT}/fips/inventory/" >&2
  exit 1
fi

exec python3 "${SCRIPT_DIR}/validate_builtin_engine_inventory.py" "${SCHEMA}" "${FILES[@]}"
