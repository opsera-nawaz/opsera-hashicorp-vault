#!/usr/bin/env python3
"""Validate FIPS crypto inventory YAML files against fips/schemas/crypto_inventory_entry.json.

Each inventory YAML file is a mapping of engine/method name -> { entries: [...] }.
Every element of every `entries` list is validated as one crypto_inventory_entry
object. This is a small, dependency-free (stdlib json + PyYAML only) structural
validator: it checks required fields, types, enums, and the line_range pattern
directly from the schema document, rather than depending on the third-party
`jsonschema` package (not available in this environment).

Usage:
    python3 validate_inventory_schema.py <schema.json> <inventory.yaml> [<inventory.yaml> ...]

Exit code 0 if every entry in every file is valid, 1 otherwise.
"""

import json
import re
import sys

import yaml


def load_schema(schema_path):
    with open(schema_path, "r", encoding="utf-8") as f:
        return json.load(f)


def validate_entry(entry, schema, where):
    errors = []
    props = schema["properties"]
    required = schema["required"]

    if not isinstance(entry, dict):
        return [f"{where}: entry is not a mapping"]

    for field in required:
        if field not in entry:
            errors.append(f"{where}: missing required field '{field}'")

    for key, value in entry.items():
        if key not in props:
            errors.append(f"{where}: unexpected field '{key}' not in schema")
            continue
        prop = props[key]
        ptype = prop.get("type")
        if ptype == "boolean" and not isinstance(value, bool):
            errors.append(f"{where}: field '{key}' must be boolean, got {type(value).__name__}")
        elif ptype == "string" and not isinstance(value, str):
            errors.append(f"{where}: field '{key}' must be string, got {type(value).__name__}")
        elif ptype == "string" and "minLength" in prop and len(value) < prop["minLength"]:
            errors.append(f"{where}: field '{key}' shorter than minLength {prop['minLength']}")
        elif ptype == "string" and "enum" in prop and value not in prop["enum"]:
            errors.append(f"{where}: field '{key}' value '{value}' not in enum {prop['enum']}")
        elif ptype == "string" and "pattern" in prop and not re.match(prop["pattern"], value):
            errors.append(f"{where}: field '{key}' value '{value}' does not match pattern {prop['pattern']}")

    return errors


def iter_entries(doc):
    """Yield (label, entry) for every entry list nested under any 'entries' key."""
    if isinstance(doc, dict):
        for key, value in doc.items():
            if key == "entries" and isinstance(value, list):
                for idx, entry in enumerate(value):
                    yield (f"{key}[{idx}]", entry)
            else:
                for label, entry in iter_entries(value):
                    yield (f"{key}.{label}", entry)
    elif isinstance(doc, list):
        for idx, item in enumerate(doc):
            for label, entry in iter_entries(item):
                yield (f"[{idx}].{label}", entry)


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 1

    schema_path = argv[1]
    inventory_paths = argv[2:]
    schema = load_schema(schema_path)

    total_entries = 0
    total_errors = 0

    for inv_path in inventory_paths:
        with open(inv_path, "r", encoding="utf-8") as f:
            doc = yaml.safe_load(f)

        file_entries = 0
        file_errors = []
        for label, entry in iter_entries(doc):
            file_entries += 1
            file_errors.extend(validate_entry(entry, schema, f"{inv_path}:{label}"))

        total_entries += file_entries
        total_errors += len(file_errors)

        if file_errors:
            print(f"FAIL {inv_path}: {file_entries} entries checked, {len(file_errors)} error(s)")
            for err in file_errors:
                print(f"  - {err}")
        else:
            print(f"PASS {inv_path}: {file_entries} entries checked, 0 errors")

    print(f"\nTotal: {total_entries} entries checked across {len(inventory_paths)} file(s), {total_errors} error(s)")
    return 0 if total_errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
