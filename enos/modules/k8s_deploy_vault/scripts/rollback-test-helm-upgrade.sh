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
[[ -z "$IMAGE_REPOSITORY" ]] && fail "IMAGE_REPOSITORY env variable has not been set"
[[ -z "$IMAGE_TAG" ]] && fail "IMAGE_TAG env variable has not been set"

kubeconfig=$(mktemp)
trap 'rm -f "$kubeconfig"' EXIT
echo "$KUBECONFIG_BASE64" | base64 -d > "$kubeconfig"
export KUBECONFIG="$kubeconfig"

echo "WO-052 AC3: helm upgrade $RELEASE_NAME (server.image.repository=$IMAGE_REPOSITORY, server.image.tag=$IMAGE_TAG)"

# --repo lets us reference the chart directly by URL, without requiring `helm repo add` to have
# been run first on whatever machine is executing this scenario.
helm upgrade "$RELEASE_NAME" vault \
  --repo https://helm.releases.hashicorp.com \
  --kube-context "$CONTEXT_NAME" \
  --namespace "$NAMESPACE" \
  --reuse-values \
  --set server.image.repository="$IMAGE_REPOSITORY" \
  --set server.image.tag="$IMAGE_TAG" \
  --wait --timeout 5m
