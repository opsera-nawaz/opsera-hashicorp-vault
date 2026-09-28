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

# A dedicated "rollback-test" KV v2 mount so this never collides with the "secret" KV v1 mount
# that ../../k8s_vault_verify_write_data manages on the same cluster.
kubectl --context "$CONTEXT_NAME" -n "$NAMESPACE" exec "$POD_NAME" -- \
  sh -c "VAULT_TOKEN=$VAULT_ROOT_TOKEN vault secrets enable -path=rollback-test -version=2 kv" \
  || echo "rollback-test mount may already exist, continuing"

kubectl --context "$CONTEXT_NAME" -n "$NAMESPACE" exec "$POD_NAME" -- \
  sh -c "VAULT_TOKEN=$VAULT_ROOT_TOKEN vault kv put rollback-test/smoke value=wo-052-k8s-rollback-fixture"
