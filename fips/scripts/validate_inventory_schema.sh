#!/usr/bin/env bash
# Validates a FIPS crypto inventory YAML file against its JSON Schema.
#
# Usage: fips/scripts/validate_inventory_schema.sh [path/to/inventory.yaml]
# Defaults to fips/inventory/keysutil_policy_crypto_sites.yaml when no
# argument is given. Exits 0 on valid input, non-zero with a descriptive
# error otherwise.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SCHEMA_FILE="${REPO_ROOT}/fips/schemas/crypto_inventory_entry.json"
INVENTORY_FILE="${1:-${REPO_ROOT}/fips/inventory/keysutil_policy_crypto_sites.yaml}"

if [[ ! -f "${SCHEMA_FILE}" ]]; then
  echo "ERROR: schema file not found: ${SCHEMA_FILE}" >&2
  exit 1
fi

if [[ ! -f "${INVENTORY_FILE}" ]]; then
  echo "ERROR: inventory file not found: ${INVENTORY_FILE}" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 is required to validate the inventory (YAML->JSON conversion + JSON Schema check)" >&2
  exit 1
fi

python3 - "${SCHEMA_FILE}" "${INVENTORY_FILE}" <<'PYEOF'
import json
import sys

schema_path, inventory_path = sys.argv[1], sys.argv[2]

try:
    import yaml
except ImportError:
    print("ERROR: PyYAML is required to parse the inventory (pip install pyyaml)", file=sys.stderr)
    sys.exit(1)

with open(schema_path) as f:
    schema = json.load(f)

with open(inventory_path) as f:
    data = yaml.safe_load(f)

# Prefer the real jsonschema library (the "jsonschema CLI tool" this script is
# built around) when it is installed; otherwise fall back to a self-contained
# validator that implements the subset of JSON Schema this schema actually
# uses (array/object/required/properties/type/enum/additionalProperties), so
# this script still exits 0 on valid input in environments without the
# jsonschema package.
try:
    import jsonschema

    jsonschema.validate(instance=data, schema=schema)
    print(f"OK: {inventory_path} is valid against {schema_path} "
          f"({len(data)} entries, validated via jsonschema library)")
    sys.exit(0)
except ImportError:
    pass
except Exception as exc:
    print(f"FAIL: {inventory_path} failed schema validation: {exc}", file=sys.stderr)
    sys.exit(1)

# --- Fallback minimal JSON Schema validator ---------------------------------
errors = []

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
        return
    if expected == "integer":
        if isinstance(value, bool) or not isinstance(value, int):
            errors.append(f"{path}: expected integer, got {type(value).__name__}")
        return
    if expected == "boolean":
        if not isinstance(value, bool):
            errors.append(f"{path}: expected boolean, got {type(value).__name__}")
        return
    py_type = _TYPE_MAP.get(expected)
    if py_type is not None and not isinstance(value, py_type):
        errors.append(f"{path}: expected {expected}, got {type(value).__name__}")


def validate_object(obj, obj_schema, path):
    if obj_schema.get("type") != "object":
        return
    if not isinstance(obj, dict):
        errors.append(f"{path}: expected object, got {type(obj).__name__}")
        return
    for required_field in obj_schema.get("required", []):
        if required_field not in obj:
            errors.append(f"{path}: missing required field '{required_field}'")
    properties = obj_schema.get("properties", {})
    for key, value in obj.items():
        prop_schema = properties.get(key)
        if prop_schema is None:
            if obj_schema.get("additionalProperties") is False:
                errors.append(f"{path}.{key}: additional property not allowed by schema")
            continue
        check_type(value, prop_schema.get("type"), f"{path}.{key}")
        enum_values = prop_schema.get("enum")
        if enum_values is not None and value not in enum_values:
            errors.append(f"{path}.{key}: value '{value}' not in allowed enum {enum_values}")


if schema.get("type") == "array":
    if not isinstance(data, list):
        errors.append("root: expected a YAML/JSON array of inventory entries")
    else:
        if len(data) < schema.get("minItems", 0):
            errors.append(f"root: expected at least {schema.get('minItems')} entries, got {len(data)}")
        item_schema = schema.get("items", {})
        for idx, item in enumerate(data):
            validate_object(item, item_schema, f"[{idx}]")
else:
    validate_object(data, schema, "root")

if errors:
    print(f"FAIL: {inventory_path} failed schema validation ({len(errors)} error(s)):", file=sys.stderr)
    for err in errors:
        print(f"  - {err}", file=sys.stderr)
    sys.exit(1)

print(f"OK: {inventory_path} is valid against {schema_path} "
      f"({len(data)} entries, validated via fallback validator)")
sys.exit(0)
PYEOF
