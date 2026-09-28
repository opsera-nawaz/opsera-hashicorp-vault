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
[[ -z "$RELEASE_NAME" ]] && fail "RELEASE_NAME env variable has not been set"
[[ -z "$NAMESPACE" ]] && fail "NAMESPACE env variable has not been set"

kubeconfig=$(mktemp)
trap 'rm -f "$kubeconfig"' EXIT
echo "$KUBECONFIG_BASE64" | base64 -d > "$kubeconfig"
export KUBECONFIG="$kubeconfig"

# WO-052 edge case: "Helm rollback may fail if the release history has been pruned (default max
# history is 10)." Verify the pre-upgrade revision (1) is still in history before attempting to
# roll back to it, so a pruned-history failure is reported clearly instead of as an opaque helm
# error.
if ! helm history "$RELEASE_NAME" --kube-context "$CONTEXT_NAME" --namespace "$NAMESPACE" -o json |
  jq -e '[.[] | select(.revision == 1)] | length > 0' > /dev/null; then
  fail "WO-052 AC3 FAILED: helm release history for $RELEASE_NAME no longer contains revision 1 (pruned) -- cannot roll back"
fi

helm rollback "$RELEASE_NAME" 1 \
  --kube-context "$CONTEXT_NAME" \
  --namespace "$NAMESPACE" \
  --wait --timeout 5m

echo "Waiting for all $RELEASE_NAME server pods to reach Ready after rollback"
kubectl wait pods \
  --context "$CONTEXT_NAME" \
  --namespace "$NAMESPACE" \
  --selector "app.kubernetes.io/name=vault,component=server" \
  --for=condition=Ready \
  --timeout=5m

# WO-052 AC3: GET /v1/sys/health must return 200 (active, unsealed) or 429 (standby, unsealed).
# Executed from inside a server pod against the pod's own loopback listener, since there is no
# ingress/NodePort exposing :8200 outside the cluster in this test topology.
health_code=""
for _ in $(seq 1 30); do
  pod=$(kubectl --context "$CONTEXT_NAME" --namespace "$NAMESPACE" get pods \
    --selector "app.kubernetes.io/name=vault,component=server" \
    -o jsonpath='{.items[0].metadata.name}')
  health_code=$(kubectl --context "$CONTEXT_NAME" --namespace "$NAMESPACE" exec "$pod" -- \
    sh -c "wget -q -O /dev/null -S http://127.0.0.1:8200/v1/sys/health 2>&1 | awk '/^ *HTTP/{print \$2; exit}'" || echo "")
  if [[ "$health_code" == "200" || "$health_code" == "429" ]]; then
    break
  fi
  sleep 10
done

if [[ "$health_code" != "200" && "$health_code" != "429" ]]; then
  fail "WO-052 AC3 FAILED: GET /v1/sys/health did not return 200 or 429 within the retry window after rollback (last code: '$health_code')"
fi

echo "WO-052 AC3 PASSED: pods Ready and GET /v1/sys/health returned $health_code after helm rollback"
