#!/usr/bin/env bash
# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

# verify-fips-node-scheduling.sh is the WO-059 quality gate FIPS-CONTAINER-001
# check: it confirms a single Vault pod (ce.fips edition) is running on a
# Kubernetes node that carries every label in NODE_SELECTOR_JSON, i.e. that
# the node affinity/selector wired into enos/modules/k8s_deploy_vault
# (WO-059) actually constrained scheduling the way it's supposed to -- a
# FIPS-capable container image (WO-046) on a non-FIPS host is not a
# FIPS-compliant deployment.
#
# This distinguishes three outcomes (see WO-059 edge_cases):
#   - Running on a node with every expected FIPS label: PASS.
#   - Running on a node missing (or mismatching) an expected FIPS label:
#     FAIL -- the affinity/selector was not honored.
#   - Pending (no nodeName assigned yet): FAIL, and this script inspects
#     the pod's PodScheduled condition to report *why* -- unschedulable
#     because no node satisfies the nodeSelector/affinity (the expected
#     failure mode when a cluster has no FIPS-labeled nodes) versus
#     unschedulable for a different reason (e.g. insufficient CPU/memory
#     on an otherwise-eligible node) -- so this never reports a false PASS
#     by hanging or timing out silently.
#
# Usage:
#   verify-fips-node-scheduling.sh
# Required environment variables:
#   KUBECONFIG_BASE64, CONTEXT_NAME, POD_NAME, NAMESPACE,
#   NODE_SELECTOR_JSON (a JSON object of label key/value pairs, e.g.
#   {"vault.hashicorp.com/fips":"true"})
#
# Exit codes: 0 on PASS, 1 on usage/tooling error, 2 on FAIL (wrong/missing
# node label, or Pending for any reason).

set -euo pipefail

fail() {
  echo "$1" 1>&2
  exit 2
}

: "${KUBECONFIG_BASE64:?KUBECONFIG_BASE64 env variable has not been set}"
: "${CONTEXT_NAME:?CONTEXT_NAME env variable has not been set}"
: "${POD_NAME:?POD_NAME env variable has not been set}"
: "${NAMESPACE:?NAMESPACE env variable has not been set}"
: "${NODE_SELECTOR_JSON:?NODE_SELECTOR_JSON env variable has not been set}"

command -v kubectl >/dev/null 2>&1 || { echo "kubectl is required but not found on PATH" 1>&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required but not found on PATH" 1>&2; exit 1; }

kubeconfig=$(mktemp)
trap 'rm -f "$kubeconfig"' EXIT
echo "$KUBECONFIG_BASE64" | base64 -d > "$kubeconfig"
export KUBECONFIG="$kubeconfig"

KCTL=(kubectl --context "$CONTEXT_NAME" -n "$NAMESPACE")

pod_json="$("${KCTL[@]}" get pod "$POD_NAME" -o json)"
pod_phase="$(echo "$pod_json" | jq -r '.status.phase // "Unknown"')"
node_name="$(echo "$pod_json" | jq -r '.spec.nodeName // empty')"

echo "verify-fips-node-scheduling: pod=${POD_NAME} phase=${pod_phase} nodeName=${node_name:-<unassigned>}"

if [[ -z "$node_name" ]]; then
  scheduled_message="$(echo "$pod_json" | jq -r '[.status.conditions[]? | select(.type=="PodScheduled")][0].message // "no PodScheduled condition reported yet"')"

  echo "----- pod scheduling condition -----"
  echo "$scheduled_message"
  echo "-------------------------------------"

  if echo "$scheduled_message" | grep -Eqi "didn.t match (Pod's )?node affinity|didn.t match node selector|had untolerated taint"; then
    fail "FAIL: pod ${POD_NAME} is Pending -- unschedulable because no node satisfies the FIPS node selector/affinity/toleration (expected when the cluster has no node labeled ${NODE_SELECTOR_JSON}): ${scheduled_message}"
  fi
  fail "FAIL: pod ${POD_NAME} is Pending for a reason other than the FIPS node selector (phase=${pod_phase}): ${scheduled_message}"
fi

node_labels_json="$("${KCTL[@]}" get node "$node_name" -o json | jq -c '.metadata.labels // {}')"

mismatches=""
while IFS=$'\t' read -r key expected; do
  actual="$(echo "$node_labels_json" | jq -r --arg k "$key" '.[$k] // "<absent>"')"
  if [[ "$actual" != "$expected" ]]; then
    mismatches+="  ${key}: expected=${expected} actual=${actual}\n"
  fi
done < <(echo "$NODE_SELECTOR_JSON" | jq -r 'to_entries[] | [.key, .value] | @tsv')

if [[ -n "$mismatches" ]]; then
  fail "FAIL: pod ${POD_NAME} is scheduled on node ${node_name}, which does not carry all expected FIPS labels:
$(echo -e "$mismatches")"
fi

echo "verify-fips-node-scheduling: PASS -- pod ${POD_NAME} is scheduled on FIPS-enabled node ${node_name} (labels matched: ${NODE_SELECTOR_JSON})"
