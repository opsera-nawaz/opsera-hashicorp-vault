#!/usr/bin/env bash
# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

set -e

fail() {
  echo "$1" 1>&2
  exit 1
}

[[ -z "$MOUNT_PATH" ]] && fail "MOUNT_PATH env variable has not been set"
[[ -z "$SECRET_PATH" ]] && fail "SECRET_PATH env variable has not been set"
[[ -z "$SECRET_KEY" ]] && fail "SECRET_KEY env variable has not been set"
[[ -z "$SECRET_VALUE" ]] && fail "SECRET_VALUE env variable has not been set"
[[ -z "$VAULT_ADDR" ]] && fail "VAULT_ADDR env variable has not been set"
[[ -z "$VAULT_INSTALL_DIR" ]] && fail "VAULT_INSTALL_DIR env variable has not been set"
[[ -z "$VAULT_TOKEN" ]] && fail "VAULT_TOKEN env variable has not been set"

binpath=${VAULT_INSTALL_DIR}/vault
test -x "$binpath" || fail "unable to locate vault binary at $binpath"

export VAULT_FORMAT=json

# WO-052 AC4: after rollback, the secret written before the modernization deploy must still be
# readable with the correct value. Note this expects a KVv2 response payload (doubly nested
# .data.data), same as ../../verify_secrets_engines/scripts/kv-verify-value.sh.
if ! res=$("$binpath" kv get -mount="$MOUNT_PATH" "$SECRET_PATH" 2>&1); then
  fail "WO-052 AC4 FAILED: rollback did not preserve ${MOUNT_PATH}/data/${SECRET_PATH} -- read error: $res"
fi

got=$(jq -Mrc --arg KEY "$SECRET_KEY" '.data.data[$KEY] // "MISSING"' <<< "$res")
if [[ "$got" != "$SECRET_VALUE" ]]; then
  fail "WO-052 AC4 FAILED: ${MOUNT_PATH}/data/${SECRET_PATH}.${SECRET_KEY} = '$got', expected '$SECRET_VALUE'"
fi

printf "WO-052 AC4 PASSED: %s/data/%s.%s = '%s' survived rollback\n" "$MOUNT_PATH" "$SECRET_PATH" "$SECRET_KEY" "$got"
