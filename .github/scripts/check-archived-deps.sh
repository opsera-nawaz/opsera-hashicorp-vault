#!/usr/bin/env bash
# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1
#
# check-archived-deps.sh scans one or more go.mod files for requires on
# archived/deprecated Go modules, as defined in the blocklist at
# .github/archived-dependencies.json (see that file for the entry format and
# how to extend it -- no changes to this script or to the calling workflow
# are needed to add a new blocked package).
#
# Usage:
#   check-archived-deps.sh [go.mod-file ...]   # defaults to go.mod and internalshared/go.mod
#   check-archived-deps.sh --test              # run the built-in self-test and exit
#
# Exits 0 if none of the given files require a blocked module, 1 otherwise
# with a structured error for every match (package, file:line, and the
# recommended replacement).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BLOCKLIST="${BLOCKLIST:-$REPO_ROOT/.github/archived-dependencies.json}"

usage() {
  echo "Usage: $(basename "$0") [go.mod-file ...]" >&2
  echo "       $(basename "$0") --test" >&2
}

# scan_file BLOCKLIST_JSON FILE
# Prints one structured error block per match to stderr and returns 1 if any
# blocked dependency is found in FILE, 0 otherwise.
scan_file() {
  local blocklist="$1"
  local file="$2"
  local found=0

  if [[ ! -f "$file" ]]; then
    echo "warning: ${file} does not exist, skipping" >&2
    return 0
  fi

  while IFS=$'\t' read -r package replacement reason; do
    [[ -z "$package" ]] && continue

    # Escape the only regex metacharacter expected in a Go module path (.)
    # so the pattern below matches it literally.
    local escaped
    escaped=$(printf '%s' "$package" | sed -e 's/\./\\./g')

    # Match a require entry for the package itself, or for a sub-package of
    # it (e.g. github.com/denisenkom/go-mssqldb/azuread), anchored at the
    # start of the (optionally indented) line so we match require-block
    # entries without matching unrelated substrings elsewhere in the file.
    local matches
    matches=$(grep -n -E "^[[:space:]]*${escaped}([[:space:]]|/)" "$file" || true)

    [[ -z "$matches" ]] && continue

    while IFS=: read -r line_num line_content; do
      [[ -z "$line_num" ]] && continue
      found=1
      local kind="direct"
      if [[ "$line_content" == *"// indirect"* ]]; then
        kind="indirect"
      fi
      local trimmed="${line_content#"${line_content%%[![:space:]]*}"}"
      {
        echo "ERROR: archived dependency detected (${kind} require)"
        echo "  package:     ${package}"
        echo "  location:    ${file}:${line_num}"
        echo "  go.mod line: ${trimmed}"
        echo "  replacement: ${replacement}"
        echo "  reason:      ${reason}"
        echo
      } >&2
    done <<<"$matches"
  done < <(jq -r '.blocked[] | [.package, .replacement, .reason] | @tsv' "$blocklist")

  return "$found"
}

run_test() {
  local tmp_dir
  tmp_dir=$(mktemp -d)
  # shellcheck disable=SC2064
  trap "rm -rf '${tmp_dir}'" EXIT

  local tmp_gomod="${tmp_dir}/go.mod"
  local rc=0

  echo "=== test 1: go.mod containing github.com/denisenkom/go-mssqldb -> expect exit 1 ==="
  cat >"$tmp_gomod" <<'EOF'
module github.com/hashicorp/vault

go 1.25

require (
	github.com/denisenkom/go-mssqldb v0.12.3 // indirect
	github.com/hashicorp/go-hclog v1.6.3
)
EOF

  local output
  if output=$(scan_file "$BLOCKLIST" "$tmp_gomod" 2>&1); then
    echo "FAIL: expected non-zero exit for go.mod containing denisenkom/go-mssqldb"
    echo "$output"
    rc=1
  elif ! grep -q "github.com/denisenkom/go-mssqldb" <<<"$output"; then
    echo "FAIL: expected error output to name github.com/denisenkom/go-mssqldb"
    echo "$output"
    rc=1
  elif ! grep -q "github.com/microsoft/go-mssqldb" <<<"$output"; then
    echo "FAIL: expected error output to name the recommended replacement"
    echo "$output"
    rc=1
  elif ! grep -q "${tmp_gomod}:6" <<<"$output"; then
    echo "FAIL: expected error output to include file:line (line 6)"
    echo "$output"
    rc=1
  else
    echo "PASS: blocked dependency flagged with package, location, and replacement"
  fi

  echo
  echo "=== test 2: go.mod without blocked deps -> expect exit 0 ==="
  cat >"$tmp_gomod" <<'EOF'
module github.com/hashicorp/vault

go 1.25

require (
	github.com/microsoft/go-mssqldb v1.11.2
	github.com/hashicorp/go-hclog v1.6.3
)
EOF

  if ! output=$(scan_file "$BLOCKLIST" "$tmp_gomod" 2>&1); then
    echo "FAIL: expected zero exit for go.mod without blocked dependencies"
    echo "$output"
    rc=1
  else
    echo "PASS: clean go.mod passes with exit 0"
  fi

  echo
  if [[ $rc -eq 0 ]]; then
    echo "All tests passed."
  else
    echo "One or more tests FAILED."
  fi
  return $rc
}

main() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    usage
    exit 0
  fi

  if [[ "${1:-}" == "--test" ]]; then
    run_test
    exit $?
  fi

  if [[ ! -f "$BLOCKLIST" ]]; then
    echo "ERROR: blocklist file not found at ${BLOCKLIST}" >&2
    exit 1
  fi

  local files=("$@")
  if [[ ${#files[@]} -eq 0 ]]; then
    files=("${REPO_ROOT}/go.mod" "${REPO_ROOT}/internalshared/go.mod")
  fi

  local overall=0
  local f
  for f in "${files[@]}"; do
    if ! scan_file "$BLOCKLIST" "$f"; then
      overall=1
    fi
  done

  if [[ $overall -ne 0 ]]; then
    echo "One or more go.mod files reference archived/deprecated dependencies. See errors above." >&2
    exit 1
  fi

  echo "OK: no archived dependencies found in: ${files[*]}"
  exit 0
}

main "$@"
