#!/usr/bin/env bash
# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

set -eou pipefail

fail() {
  echo "$1" 1>&2
  exit 1
}

[[ -z "$VAULT_ADDR" ]] && fail "VAULT_ADDR env variable has not been set"
[[ -z "$VAULT_INSTALL_DIR" ]] && fail "VAULT_INSTALL_DIR env variable has not been set"
[[ -z "$VAULT_SEAL_TYPE" ]] && fail "VAULT_SEAL_TYPE env variable has not been set"
[[ -z "$RESTART_DELAY_SECONDS" ]] && fail "RESTART_DELAY_SECONDS env variable has not been set"

binpath=${VAULT_INSTALL_DIR}/vault
test -x "$binpath" || fail "unable to locate vault binary at $binpath"

# Capture this node's own view of cluster leadership before we restart it.
# GET /v1/sys/leader is unauthenticated, so this works even without a token.
# We use this to tell a *planned* hand-off (we are restarting the node that
# was already the leader) apart from an *unplanned* election (some other
# node's restart is what changed leadership) -- see the AC1 assertion below.
pre_leader_json=$(curl -sf "${VAULT_ADDR}/v1/sys/leader" || echo '{}')
was_leader=$(echo "$pre_leader_json" | jq -r '.is_self // false')
pre_leader_addr=$(echo "$pre_leader_json" | jq -r '.leader_address // "unknown"')

echo "rolling restart: predecessor=${ROLLING_RESTART_PREDECESSOR_ID:-none} was_leader=${was_leader}: stopping vault (binary-swap simulation)"
if ! out=$(sudo systemctl stop vault 2>&1); then
  fail "failed to stop vault: $out: $(sudo systemctl status vault)"
fi

if ! out=$(sudo systemctl daemon-reload 2>&1); then
  fail "failed to daemon-reload systemd: $out"
fi

if ! out=$(sudo systemctl start vault 2>&1); then
  fail "failed to start vault: $out: $(sudo systemctl status vault)"
fi

count=0
retries=5
while :; do
  # 0 is unsealed, 2 is running but sealed -- both mean the node is back up.
  status=$($binpath status)
  code=$?

  if [ "$code" == 0 ] || [ "$code" == 2 ]; then
    echo "$status"
    break
  fi

  printf "waiting for vault to come back up after rolling restart: status code: %s, status:\n%s\n" "$code" "$status" 1>&2

  wait=$((3 ** count))
  count=$((count + 1))
  if [ "$count" -lt "$retries" ]; then
    sleep "$wait"
  else
    fail "timed out waiting for vault node to be ready after rolling restart"
  fi
done

if [ "$VAULT_SEAL_TYPE" = "shamir" ] && [ -n "${VAULT_UNSEAL_KEYS:-}" ]; then
  echo "re-unsealing node after rolling restart (shamir seal)"
  IFS=',' read -ra unseal_keys <<< "$VAULT_UNSEAL_KEYS"
  for key in "${unseal_keys[@]}"; do
    if ! "$binpath" operator unseal "$key" >/dev/null; then
      fail "failed to submit unseal key to restarted node"
    fi
  done

  if ! "$binpath" status >/dev/null 2>&1; then
    fail "node is still sealed after submitting all unseal keys"
  fi
fi

# AC1: restarting a non-leader node must not change who the cluster leader
# is. If it does, that's an unplanned election caused by this restart, and
# the scenario must fail loudly rather than let it silently pass.
post_leader_json=$(curl -sf "${VAULT_ADDR}/v1/sys/leader" || echo '{}')
post_leader_addr=$(echo "$post_leader_json" | jq -r '.leader_address // "unknown"')
if [ "$was_leader" != "true" ] && [ "$pre_leader_addr" != "unknown" ] && [ "$post_leader_addr" != "unknown" ] && [ "$pre_leader_addr" != "$post_leader_addr" ]; then
  fail "AC1 violation: unplanned leader election detected -- restarting a non-leader node changed the cluster leader from ${pre_leader_addr} to ${post_leader_addr}"
fi

echo "node restarted and unsealed successfully, waiting ${RESTART_DELAY_SECONDS}s before allowing the next node to restart"
sleep "$RESTART_DELAY_SECONDS"
