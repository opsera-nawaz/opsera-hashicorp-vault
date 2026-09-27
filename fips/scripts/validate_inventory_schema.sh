#!/usr/bin/env bash
# Validates a FIPS crypto inventory YAML file against
# fips/schemas/crypto_inventory_entry.json.
#
# Usage: fips/scripts/validate_inventory_schema.sh <inventory.yaml> [schema.json]
#
# Only depends on python3 + PyYAML (already present in the dev environment).
# Deliberately avoids requiring `pip install jsonschema` or any Node/ajv
# dependency so it can run in a bare Go-toolchain CI image; it implements the
# small subset of JSON Schema draft-07 actually used by
# crypto_inventory_entry.json (type, required, properties.type/enum/pattern/
# minimum/minLength, additionalProperties).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

INVENTORY_FILE="${1:-$REPO_ROOT/fips/inventory/core_barrier_seal_crypto_sites.yaml}"
SCHEMA_FILE="${2:-$REPO_ROOT/fips/schemas/crypto_inventory_entry.json}"

if [[ ! -f "$INVENTORY_FILE" ]]; then
  echo "ERROR: inventory file not found: $INVENTORY_FILE" >&2
  exit 1
fi
if [[ ! -f "$SCHEMA_FILE" ]]; then
  echo "ERROR: schema file not found: $SCHEMA_FILE" >&2
  exit 1
fi

python3 - "$INVENTORY_FILE" "$SCHEMA_FILE" <<'PYEOF'
import json
import re
import sys

import yaml

inventory_path, schema_path = sys.argv[1], sys.argv[2]

with open(schema_path) as f:
    schema = json.load(f)

with open(inventory_path) as f:
    doc = yaml.safe_load(f)

entries = doc.get("entries") if isinstance(doc, dict) else doc
if entries is None:
    print(f"ERROR: no top-level 'entries' list found in {inventory_path}", file=sys.stderr)
    sys.exit(1)
if not isinstance(entries, list) or len(entries) == 0:
    print(f"ERROR: 'entries' must be a non-empty list in {inventory_path}", file=sys.stderr)
    sys.exit(1)

required = schema.get("required", [])
properties = schema.get("properties", {})
additional_allowed = schema.get("additionalProperties", True)

errors = []

def check_type(value, expected_type):
    if expected_type == "string":
        return isinstance(value, str)
    if expected_type == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected_type == "boolean":
        return isinstance(value, bool)
    if expected_type == "object":
        return isinstance(value, dict)
    if expected_type == "array":
        return isinstance(value, list)
    return True

for idx, entry in enumerate(entries):
    where = f"entries[{idx}] ({entry.get('file', '?')}:{entry.get('line', '?')})"
    if not isinstance(entry, dict):
        errors.append(f"{where}: entry is not an object")
        continue

    for field in required:
        if field not in entry:
            errors.append(f"{where}: missing required field '{field}'")

    if not additional_allowed:
        for key in entry:
            if key not in properties:
                errors.append(f"{where}: unexpected field '{key}' not in schema")

    for field, value in entry.items():
        prop_schema = properties.get(field)
        if prop_schema is None:
            continue

        expected_type = prop_schema.get("type")
        if expected_type and not check_type(value, expected_type):
            errors.append(f"{where}: field '{field}' expected type {expected_type}, got {type(value).__name__}")
            continue

        if "enum" in prop_schema and value not in prop_schema["enum"]:
            errors.append(f"{where}: field '{field}' value '{value}' not in enum {prop_schema['enum']}")

        if expected_type == "string":
            min_length = prop_schema.get("minLength")
            if min_length is not None and len(value) < min_length:
                errors.append(f"{where}: field '{field}' shorter than minLength {min_length}")
            pattern = prop_schema.get("pattern")
            if pattern and not re.match(pattern, value):
                errors.append(f"{where}: field '{field}' value '{value}' does not match pattern {pattern}")

        if expected_type == "integer":
            minimum = prop_schema.get("minimum")
            if minimum is not None and value < minimum:
                errors.append(f"{where}: field '{field}' value {value} below minimum {minimum}")

if errors:
    print(f"FAIL: {len(errors)} schema violation(s) in {inventory_path}", file=sys.stderr)
    for err in errors:
        print(f"  - {err}", file=sys.stderr)
    sys.exit(1)

print(f"PASS: {len(entries)} entries in {inventory_path} validated against {schema_path}")
PYEOF
