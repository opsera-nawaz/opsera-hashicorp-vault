#!/usr/bin/env bash
# Validates the WO-019 consolidated FIPS 140-3 cryptographic inventory
# artifact (fips/crypto_inventory.yaml) against its master JSON Schema
# (fips/schemas/consolidated_inventory.json), confirms every required
# sub-inventory file is referenced, and cross-checks the summary section's
# counts against the actual crypto_call_sites entries.
#
# Usage: fips/scripts/validate_consolidated_inventory.sh [path/to/crypto_inventory.yaml]
# Defaults to fips/crypto_inventory.yaml. Exits 0 on success, non-zero with a
# descriptive error otherwise. Only depends on python3 + PyYAML — uses the
# real `jsonschema` library when installed, otherwise falls back to a
# self-contained validator implementing the subset of JSON Schema draft-07
# this schema actually uses, matching the pattern of the other fips/scripts/
# validate_*.sh scripts in this repository.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

SCHEMA_FILE="${REPO_ROOT}/fips/schemas/consolidated_inventory.json"
INVENTORY_FILE="${1:-${REPO_ROOT}/fips/crypto_inventory.yaml}"

if [[ ! -f "${SCHEMA_FILE}" ]]; then
  echo "ERROR: master schema not found: ${SCHEMA_FILE}" >&2
  exit 1
fi

if [[ ! -f "${INVENTORY_FILE}" ]]; then
  echo "ERROR: consolidated inventory not found: ${INVENTORY_FILE}" >&2
  echo "       run: python3 fips/scripts/merge_inventory.py" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 is required to validate the consolidated inventory" >&2
  exit 1
fi

python3 - "${SCHEMA_FILE}" "${INVENTORY_FILE}" "${REPO_ROOT}" <<'PYEOF'
import json
import sys

schema_path, inventory_path, repo_root = sys.argv[1], sys.argv[2], sys.argv[3]

try:
    import yaml
except ImportError:
    print("ERROR: PyYAML is required to parse the inventory (pip install pyyaml)", file=sys.stderr)
    sys.exit(1)

with open(schema_path, encoding="utf-8") as f:
    schema = json.load(f)

with open(inventory_path, encoding="utf-8") as f:
    data = yaml.safe_load(f)

errors = []

# --- 1. Structural JSON Schema validation ----------------------------------

_TYPE_MAP = {
    "string": str,
    "integer": int,
    "boolean": bool,
    "array": list,
    "object": dict,
    "number": (int, float),
}


def check_type(value, expected, path):
    if expected is None:
        return True
    if expected == "integer":
        ok = isinstance(value, int) and not isinstance(value, bool)
    elif expected == "boolean":
        ok = isinstance(value, bool)
    else:
        py_type = _TYPE_MAP.get(expected)
        ok = py_type is None or isinstance(value, py_type)
    if not ok:
        errors.append(f"{path}: expected {expected}, got {type(value).__name__}")
    return ok


def validate_node(value, node_schema, path):
    if not isinstance(node_schema, dict):
        return
    expected_type = node_schema.get("type")
    if expected_type and not check_type(value, expected_type, path):
        return

    if expected_type == "object" and isinstance(value, dict):
        for field in node_schema.get("required", []):
            if field not in value:
                errors.append(f"{path}: missing required field '{field}'")
        properties = node_schema.get("properties", {})
        for key, sub_value in value.items():
            prop_schema = properties.get(key)
            if prop_schema is None:
                if node_schema.get("additionalProperties") is False:
                    errors.append(f"{path}.{key}: additional property not allowed by schema")
                continue
            validate_node(sub_value, prop_schema, f"{path}.{key}")

    elif expected_type == "array" and isinstance(value, list):
        min_items = node_schema.get("minItems")
        if min_items is not None and len(value) < min_items:
            errors.append(f"{path}: expected at least {min_items} items, got {len(value)}")
        item_schema = node_schema.get("items")
        if item_schema:
            for idx, item in enumerate(value):
                validate_node(item, item_schema, f"{path}[{idx}]")

    elif expected_type == "string" and isinstance(value, str):
        enum_values = node_schema.get("enum")
        if enum_values is not None and value not in enum_values:
            errors.append(f"{path}: value '{value}' not in allowed enum {enum_values}")


try:
    import jsonschema

    jsonschema.validate(instance=data, schema=schema)
    print(f"OK (jsonschema library): {inventory_path} matches {schema_path}")
except ImportError:
    validate_node(data, schema, "root")
    if errors:
        print(f"FAIL: {inventory_path} failed schema validation ({len(errors)} error(s)):", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        sys.exit(1)
    print(f"OK (fallback validator): {inventory_path} matches {schema_path}")
except Exception as exc:
    print(f"FAIL: {inventory_path} failed schema validation: {exc}", file=sys.stderr)
    sys.exit(1)

# --- 2. Every required sub-inventory file must be referenced ---------------

REQUIRED_SOURCE_FILES = {
    "fips/inventory/keysutil_policy_crypto_sites.yaml",
    "fips/inventory/core_barrier_seal_crypto_sites.yaml",
    "fips/inventory/builtin_logical_crypto_sites.yaml",
    "fips/inventory/builtin_credential_crypto_sites.yaml",
    "fips/inventory/tls_listener_config.yaml",
    "fips/inventory/crypto_dependencies.yaml",
    "fips/inventory/container_kms_inventory.yaml",
    "fips/inventory/ce_fips_build_tag_verification.yaml",
}

referenced = {
    entry.get("file")
    for entry in data.get("metadata", {}).get("source_inventories", [])
    if isinstance(entry, dict)
}
missing_refs = REQUIRED_SOURCE_FILES - referenced
if missing_refs:
    errors.append(
        "metadata.source_inventories is missing required sub-inventory file(s): "
        + ", ".join(sorted(missing_refs))
    )

import os

for rel_path in REQUIRED_SOURCE_FILES:
    if not os.path.isfile(os.path.join(repo_root, rel_path)):
        errors.append(f"referenced sub-inventory file does not exist on disk: {rel_path}")

# --- 3. Summary counts must match the actual crypto_call_sites entries -----

call_sites = data.get("crypto_call_sites", [])
if not isinstance(call_sites, list):
    errors.append("crypto_call_sites must be a list")
    call_sites = []

MODULE_BOUNDARIES = ["barrier-internal", "seal-external-kms", "seal-shamir", "core-orchestration"]

recomputed = {
    "total_crypto_call_sites": len(call_sites),
    "fips_approved_count": sum(1 for e in call_sites if e.get("fips_approved") is True),
    "non_approved_count": sum(1 for e in call_sites if e.get("fips_approved") is False),
    "security_relevant_count": sum(1 for e in call_sites if e.get("security_relevant") is True),
    "non_security_relevant_count": sum(1 for e in call_sites if e.get("security_relevant") is False),
    "enterprise_only_count": sum(1 for e in call_sites if e.get("enterprise_only") is True),
}
recomputed_by_boundary = {b: 0 for b in MODULE_BOUNDARIES}
for e in call_sites:
    mb = e.get("module_boundary")
    if mb in recomputed_by_boundary:
        recomputed_by_boundary[mb] += 1

declared = data.get("summary", {})
for key, expected in recomputed.items():
    actual = declared.get(key)
    if actual != expected:
        errors.append(f"summary.{key}: declared {actual!r} but recomputed {expected!r} from crypto_call_sites")

declared_by_boundary = declared.get("by_module_boundary", {})
for boundary, expected in recomputed_by_boundary.items():
    actual = declared_by_boundary.get(boundary)
    if actual != expected:
        errors.append(
            f"summary.by_module_boundary.{boundary}: declared {actual!r} but recomputed {expected!r}"
        )

# --- 4. Quality gate statuses must use an allowed value ---------------------

ALLOWED_STATUSES = {"PASS", "PARTIAL", "FAIL", "BLOCKED"}
for gate_id in ("FIPS-CRYPTO-001", "FIPS-DEP-001", "FIPS-CONTAINER-001"):
    gate = data.get("quality_gates", {}).get(gate_id)
    if not isinstance(gate, dict):
        errors.append(f"quality_gates.{gate_id} is missing")
        continue
    if gate.get("status") not in ALLOWED_STATUSES:
        errors.append(f"quality_gates.{gate_id}.status: '{gate.get('status')}' is not one of {ALLOWED_STATUSES}")

if errors:
    print(f"FAIL: {len(errors)} validation error(s) in {inventory_path}:", file=sys.stderr)
    for err in errors:
        print(f"  - {err}", file=sys.stderr)
    sys.exit(1)

print(
    f"PASS: {inventory_path} — {len(call_sites)} crypto_call_sites, "
    f"all {len(REQUIRED_SOURCE_FILES)} sub-inventory files referenced, "
    "summary counts reconciled, quality gate statuses valid."
)
sys.exit(0)
PYEOF
