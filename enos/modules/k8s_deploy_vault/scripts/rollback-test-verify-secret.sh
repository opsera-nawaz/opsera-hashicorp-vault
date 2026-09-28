#!/usr/bin/env bash
# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

set -e

fail() {
  echo "$1" 1>&2
  exit 1
}

[[ -z "$KUBECONFIG_BASE64" ]] && fail "KUBECONFIG_BASE64 env variable has not been set"
[[ -z "$CONTEXT_NAME" ]] && fail "CONTEXT_NAME env variable has not been set"
[[ -z "$NAMESPACE" ]] && fail "NAMESPACE env variable has not been set"
[[ -z "$POD_NAME" ]] && fail "POD_NAME env variable has not been set"
[[ -z "$VAULT_ROOT_TOKEN" ]] && fail "VAULT_ROOT_TOKEN env variable has not been set"

kubeconfig=$(mktemp)
trap 'rm -f "$kubeconfig"' EXIT
echo "$KUBECONFIG_BASE64" | base64 -d > "$kubeconfig"
export KUBECONFIG="$kubeconfig"

if ! res=$(kubectl --context "$CONTEXT_NAME" -n "$NAMESPACE" exec "$POD_NAME" -- \
  sh -c "VAULT_TOKEN=$VAULT_ROOT_TOKEN VAULT_FORMAT=json vault kv get rollback-test/smoke" 2>&1); then
  fail "WO-052 AC3 FAILED: could not read rollback-test/smoke after helm rollback -- $res"
fi

got=$(echo "$res" | jq -Mrc '.data.data.value // "MISSING"')
if [[ "$got" != "wo-052-k8s-rollback-fixture" ]]; then
  fail "WO-052 AC3 FAILED: rollback-test/smoke.value = '$got', expected 'wo-052-k8s-rollback-fixture'"
fi

echo "WO-052 AC3 PASSED: rollback-test/smoke.value = '$got' survived helm rollback"
