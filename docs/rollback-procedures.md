# Rollback Procedures

**WO-052 · Backward Compatibility, Regression Prevention, and Rollback Validation**

This runbook documents how to recover to the pre-change state within **30 minutes** for any
modernization-phase deployment (handler registry migration, module boundary refactors, UI
TypeScript changes, MSSQL driver changes, FIPS algorithm gating, etc.), for each of the three
ways this repository's changes reach a running Vault cluster:

1. [Terraform/Enos binary swap](#method-1-terraformenos-binary-swap) — VM/EC2 deployments that
   install Vault as a systemd-managed binary.
2. [Kubernetes/Helm rollback](#method-2-kuberneteshelm-rollback) — StatefulSet deployments
   managed by the `hashicorp/vault` Helm chart.
3. [git revert for code-only changes](#method-3-git-revert-for-code-only-changes) — changes that
   never left source control (caught in code review or CI before a release was cut).

Automated validation for methods 1 and 2 lives in `enos/enos-scenario-rollback-validation.hcl`
(Terraform/Enos) and `enos/modules/k8s_deploy_vault/main.tf` (`var.enable_rollback_test`,
Kubernetes/Helm). Both measure wall-clock duration and hard-fail if it is not under 1800 seconds
(30 minutes). See [Automated validation](#automated-validation) below.

## A note on `vault/rollback.go`

**Vault's internal `RollbackManager` (`vault/rollback.go`) is unrelated to this document.** It is
an application-level backend cleanup mechanism: it periodically invokes
`logical.RollbackOperation` on every mounted secrets/auth backend so that backends can clean up
partially-completed operations (for example, an AWS secrets engine that created a cloud resource
but crashed before recording a matching lease). It runs continuously inside every healthy Vault
process and has no relationship to deploying, upgrading, or rolling back the Vault binary,
container image, or Helm release itself. If you are trying to recover a cluster after a bad
modernization deploy, `RollbackManager` is not involved and does not need to be configured,
disabled, or inspected — use the procedures below instead.

## The 30-minute SLA

The SLA is measured **from the decision to roll back to full cluster health** — it does not
include the time spent diagnosing the regression that triggered the decision. Based on the
timing built into the automated scenarios, a realistic budget for a rollback that stays within
1800 seconds looks like:

| Phase | Budget | Notes |
|---|---|---|
| Binary swap / image pull | ~5 min | `enos_bundle_install` (Terraform) or `helm rollback` fetching the prior release's stored manifest (Kubernetes) — no image pull is needed since the prior image is already cached on each node from before the upgrade. |
| Rolling restart | ~10 min | Followers first, then the leader, one batch at a time (Terraform), or the StatefulSet's own rolling update (Kubernetes). |
| Unseal | ~5 min | Automatic for auto-unseal (awskms/pkcs11) seal types; scripted with `vault operator unseal` for Shamir. See [Seal state](#seal-state-is-preserved). |
| Health check convergence | ~5 min | Raft leader election + all voters rejoined (Terraform), or all pods `Ready` + `GET /v1/sys/health` returns `200`/`429` (Kubernetes). |
| Data integrity verification | ~5 min | Read back the test secret; see [Data integrity](#data-integrity-is-preserved). |

Rollback procedures must not require root token access to execute — an operator policy granting
`update` on the relevant `sys/` and cluster-management paths is sufficient for every step below.
(The automated validation scenarios use a root token only to set up and independently verify the
test-secret fixture; that is test scaffolding, not part of the procedure an operator follows.)

## Method 1: Terraform/Enos binary swap

Use this method for VM/EC2 deployments where Vault runs as a systemd-managed binary installed
from a `.zip` bundle or package.

### Prerequisites

- SSH access to every node in the cluster (the same access used to deploy the modernized build).
- The pinned pre-modernization artifact: either a public release version/edition (e.g.
  `{ edition = "ce", version = "1.16.31" }`, fetched directly from releases.hashicorp.com), an
  artifactory release object, or a locally retained `.zip`/package file. **Do not roll back to
  "latest"** — always pin to the exact version that was running before the modernization deploy,
  so the rollback is reproducible and doesn't accidentally introduce a *different* unvalidated
  change.
- Unseal keys (Shamir) or confirmation that the auto-unseal KMS/HSM is reachable (awskms/pkcs11).

### Steps

1. Identify the current Raft leader and followers (`vault operator raft list-peers`, or the
   `enos/modules/vault_get_cluster_ips` module if using Enos).
2. **Swap the binary on every node** to the pinned pre-modernization artifact. If the modernized
   deploy switched between a zip bundle and a package (or vice versa), the old systemd unit file
   may need to be removed so the correct unit is used after restart — see
   `enos/modules/vault_rollback/scripts/maybe-remove-old-unit-file.sh`.
3. **Restart every follower first, one at a time**, waiting for each to rejoin Raft and report
   healthy before restarting the next. Raft keeps serving reads and writes through the remaining
   quorum throughout this phase, so there is no availability gap.
4. **Re-unseal each follower** if using a Shamir seal (skip for auto-unseal seal types — see
   [Seal state](#seal-state-is-preserved)).
5. Once every follower is back up, rejoined, and unsealed, **restart the leader last**. This
   forces a new leader election among the already-verified followers, which is safer than
   restarting the leader first (which would force an election *before* you know the
   pre-modernization binary can even start).
6. **Re-unseal the (new) leader** if using a Shamir seal.
7. Confirm `vault operator raft list-peers` shows all nodes as voters, then read back the known
   test secret (or your own canary secret) to confirm data integrity.

This is exactly what `enos/modules/vault_rollback/main.tf` automates: it is
`enos/modules/vault_upgrade/main.tf` adapted to reinstall a pinned pre-modernization artifact
instead of a new candidate build, restarting nodes in the same followers-then-leader order (see
that file's header comment for why the order itself does not reverse).

### Expected timing

3-5 minutes for the binary swap (all nodes in parallel), 2 minutes per node for the rolling
restart (10 minutes for a 5-node cluster, ~4-6 minutes for the 3-node cluster the automated
scenario uses), and 1-2 minutes for unseal and Raft reconvergence per node. A 3-5 node cluster
should complete well within the 30-minute SLA; see
[Automated validation](#automated-validation) for a measured run.

### Troubleshooting

- **Stuck unseal (Shamir).** If `vault operator unseal` reports progress but the node never
  transitions to unsealed, confirm the unseal keys being used are for the *same* Raft cluster
  (not stale keys from a previous test cluster) and that the node's `storage "raft"` `node_id` in
  its config matches what was used when the keys were generated. If the KMS/HSM backing an
  auto-unseal seal is unreachable, the cluster stays sealed regardless of the binary version —
  restore KMS/HSM connectivity, or fall back to a manual Shamir unseal using recovery keys if the
  seal was configured with a recovery mechanism.
- **Raft leader election timeout.** If no new leader is elected within ~30 seconds of the old
  leader's restart, check `autopilot_reconcile_interval`/`autopilot_update_interval` — the
  defaults can be too slow for a fast-moving rollback and may cause autopilot to interpret a
  restarting node as dead rather than temporarily unavailable, triggering an unwanted demotion.
  The automated scenario sets both to single-digit-second values for exactly this reason; apply
  the same override during a live rollback if the cluster uses aggressive default timeouts.
- **Storage schema migration incompatibility.** If the modernized build introduced a storage
  schema or mount-table format change (rare, but possible for a large modernization), the old
  binary may fail to start against data written by the new binary, logging a version/format
  mismatch on startup. This is a **blocking condition**: do not force-restart repeatedly. Restore
  from the most recent pre-upgrade Raft snapshot instead of attempting an in-place binary
  rollback, and treat it as a signal that a schema-migrating change needs its own explicit
  rollback plan (and probably should not have shipped as an in-place-reversible change at all).

## Method 2: Kubernetes/Helm rollback

Use this method for Kubernetes deployments using the `hashicorp/vault` Helm chart
(`server.ha.raft.enabled = true`, per `enos/modules/k8s_deploy_vault/main.tf`).

### Prerequisites

- `kubectl` and `helm` access to the cluster and namespace running the release.
- **Helm release history must still contain the pre-upgrade revision.** Helm retains the last 10
  revisions by default (`--history-max`, configurable per release). Run
  `helm history <release>` *before* upgrading, and again before rolling back, to confirm the
  revision you intend to roll back to is still present. If it has been pruned, you cannot
  `helm rollback` to it — see [Troubleshooting](#troubleshooting-1).

### Steps, option A: `helm rollback` (preferred)

1. `helm history <release> -n <namespace>` — note the revision number running *before* the
   modernization deploy.
2. `helm rollback <release> <revision> -n <namespace> --wait --timeout 5m`. This reverts the
   StatefulSet spec (image, chart values) to the target revision and triggers Kubernetes' own
   rolling update of the StatefulSet's pods.
3. `kubectl wait pods -n <namespace> --selector 'app.kubernetes.io/name=vault,component=server' --for=condition=Ready --timeout=5m`.
4. Confirm health: `GET /v1/sys/health` against each pod should return `200` (active, unsealed)
   or `429` (standby, unsealed). A `501` (uninitialized) or `503` (sealed) response means the
   node has not finished coming back up — keep polling within the SLA window before escalating.
5. Read back the known test secret (or your own canary secret) to confirm data integrity.

### Steps, option B: `kubectl rollout undo`

Equivalent to option A when the StatefulSet's rollout history is what you're reverting (for
example, if the change was applied directly via `kubectl apply`/`kubectl set image` rather than
`helm upgrade`):

1. `kubectl rollout history statefulset/vault -n <namespace>` — note the revision to roll back
   to.
2. `kubectl rollout undo statefulset/vault -n <namespace> [--to-revision=<n>]`.
3. `kubectl rollout status statefulset/vault -n <namespace> --timeout=5m`.
4. Same health and data-integrity checks as option A, steps 3-5.

Prefer `helm rollback` when the deployment is Helm-managed: it reverts *all* chart values
(including any non-image config changes bundled with the modernization deploy), whereas
`kubectl rollout undo` only reverts the pod template Kubernetes itself tracked, which can leave
Helm's own release history and Kubernetes' rollout history disagreeing about the current state.

`enos/modules/k8s_deploy_vault/main.tf` (`var.enable_rollback_test = true`) automates option A
end to end: it performs a `helm upgrade` (simulating the modernization deploy), writes a test
secret, then performs the `helm rollback` and asserts pod readiness, `GET /v1/sys/health`, and
secret integrity, all under the 30-minute SLA.

### Expected timing

`helm rollback`/`kubectl rollout undo` typically completes the StatefulSet's rolling update in
2-5 minutes for a small cluster (each pod must terminate, reschedule, and pass its readiness
probe before the next one is touched, per the StatefulSet's default `OrderedReady` pod
management policy). Add 1-2 minutes for the health-check and data-integrity verification. This
leaves substantial margin under the 30-minute SLA even accounting for image pull time if the
prior image was evicted from node-local caches.

### Troubleshooting

- **Helm release history has been pruned.** If `helm history <release>` no longer shows the
  target revision (default `--history-max` is 10), `helm rollback` will fail. There is no way to
  reconstruct a pruned revision from Helm alone — redeploy the known-good chart version and
  values explicitly with `helm upgrade` instead of `helm rollback`, using your own record of what
  those values were (source control, a values file, or CI artifact from the prior release).
  Going forward, increase `--history-max` on the release, or snapshot `helm get values`/
  `helm get manifest` for the current revision before every upgrade.
- **Pods stuck `Pending`/`CrashLoopBackOff` after rollback.** Check `kubectl describe pod` for
  scheduling failures (e.g. the prior image was evicted from node-local caches and the registry
  is unreachable) or PVC binding issues if `server.dataStorage` retained a volume claim that is
  incompatible with the rolled-back version's expectations.
- **`GET /v1/sys/health` never returns 200/429.** If it returns `503` indefinitely, the pod
  restarted but did not auto-unseal — check the auto-unseal KMS/HSM connectivity from inside the
  cluster's network, same as the Terraform/Enos troubleshooting above. Kubernetes deployments in
  this repository use a Shamir seal with the unseal keys captured at cluster-init time
  (`enos_vault_init.leader.unseal_keys_b64` in `enos/modules/k8s_deploy_vault/main.tf`) — if
  auto-unseal is not configured, each pod must be manually unsealed after it restarts.

## Method 3: git revert for code-only changes

Use this method when a modernization-phase change is caught in code review, CI, or a
pre-production environment **before** it has been built into a released artifact or deployed
anywhere that matters — i.e., the fastest and safest rollback is simply "the bad code never
ships."

### Steps

1. Identify the commit(s) to revert. Modernization work in this repository lands as squash
   merges of a `feature/WO-XXX` branch into `main` — `git log --oneline main` will show a single
   merge commit per work order.
2. **If reverting a merge commit, `git revert` requires the `-m` flag** to tell git which parent
   is the "mainline" to revert relative to. For a normal `feature/WO-XXX` branch merged into
   `main`, `main` is parent 1:
   ```
   git revert -m 1 <merge-commit-sha>
   ```
   Reverting relative to the wrong parent will appear to succeed but silently produce a diff that
   reintroduces unrelated prior changes — always confirm with `git show <merge-commit-sha>` which
   parent is `main` before choosing `-m`.
3. Push the revert commit (or open a PR reverting it, per your branch protection rules) and let
   CI rebuild from `main`.
4. Redeploy the resulting build using whichever of Method 1 or Method 2 matches your environment.
   The revert itself only removes the bad code from source control and the next build — it does
   not, by itself, roll back anything already running.

### Expected timing

CI rebuild time dominates this path and varies by pipeline (this repository's
`.github/workflows/build.yml` build+test matrix is typically well under 30 minutes for a CE
build, but check current CI run times before relying on this path under time pressure). Add
Method 1 or Method 2's deploy time on top. If the bad change is already running in production,
`git revert` alone does **not** satisfy the 30-minute SLA on its own — use Method 1 or 2 to
recover the running cluster immediately, and land the `git revert` in parallel so the next
deploy doesn't reintroduce the regression.

### Troubleshooting

- **Revert conflicts.** If later commits touched the same lines, `git revert` will stop with
  conflicts. Resolve them the same way as any merge conflict; if the conflict is extensive enough
  that a clean revert isn't feasible in the time available, fall back to Method 1 or 2 against
  the last known-good deployed artifact instead of trying to force a source-level revert under
  time pressure.

## Data integrity is preserved

All three methods must preserve previously written Raft data. The automated scenarios prove this
directly: a secret is written to `secret/data/rollback-test` (Terraform/Enos scenario) or
`rollback-test/smoke` (Kubernetes test, using a dedicated mount to avoid colliding with other
k8s test fixtures) before the modernization deploy, and read back — and its value byte-for-byte
compared — after rollback completes. In-place binary/image swaps never touch the underlying Raft
storage on disk, so this should always hold *unless* the modernized version wrote data in a
format the pre-modernization version cannot read (see the storage-schema-migration
troubleshooting note under Method 1) — that is the one condition serious enough to require
restoring from a Raft snapshot instead of trusting an in-place rollback.

## Seal state is preserved

- **Auto-unseal (awskms, pkcs11):** no manual or scripted unseal call should ever be necessary.
  Vault auto-unseals itself against the configured KMS/HSM immediately on process start, in
  either direction (upgrade or rollback). `enos/modules/vault_rollback/main.tf` reflects this: its
  `enos_vault_unseal` resources are conditioned on `var.vault_seal_type == "shamir"` and simply do
  not run for awskms/pkcs11, exactly like `enos/modules/vault_upgrade/main.tf`. If auto-unseal
  fails to reach the KMS/HSM after rollback, the cluster remains sealed regardless of which
  binary is running — this is a KMS/HSM connectivity problem, not a rollback-procedure defect;
  restore connectivity, or use a configured recovery mechanism/manual Shamir fallback if one
  exists.
- **Shamir:** manual/scripted unseal is required after *every* restart, independent of whether
  the restart is an upgrade or a rollback — this is inherent to how Shamir seals work, not
  something rollback needs to work around. Keep unseal keys available (per your organization's
  key-custody policy) for the duration of any modernization deploy window so a rollback is never
  blocked on locating them.

## Automated validation

- **Terraform/Enos (Method 1):** `enos/enos-scenario-rollback-validation.hcl`. Provisions a
  3-node Raft cluster on the pinned pre-modernization release, upgrades it in place to the
  modernized candidate build (`enos/modules/vault_upgrade`), then rolls it back
  (`enos/modules/vault_rollback`) and asserts data integrity
  (`enos/modules/vault_verify_rollback_data`) and the 30-minute SLA
  (`enos/modules/vault_rollback_timer`). Run with `enos scenario run rollback_validation
  <matrix filter>` from `enos/`, per the scenario's own header comment for required variables.
- **Kubernetes/Helm (Method 2):** `enos/modules/k8s_deploy_vault/main.tf`, gated by
  `var.enable_rollback_test = true`. Exercises `helm upgrade` -> write secret -> `helm rollback`
  -> assert pod readiness + `GET /v1/sys/health` + secret integrity, all within the SLA.
- **CI:** both are wired into `.github/workflows/build.yml` as an optional, non-blocking,
  `workflow_dispatch`-only job (`rollback-validation`) for pre-release validation — it never
  gates a normal PR or push build. See that workflow file for the exact trigger condition.

**Execution note:** this repository's sandbox used to author this runbook and the scenarios
above has no `enos` CLI, no AWS credentials, and no live Kubernetes cluster, so the Enos scenario
and the Kubernetes rollback test could not be executed end-to-end here (consistent with the
CANNOT_VERIFY precedent recorded against WO-038's `enos-scenario-raft-regression.hcl`, which
faced the same constraint). Both are structurally modeled on this repository's own proven,
already-merged scenarios and modules (`enos/enos-scenario-upgrade.hcl`,
`enos/modules/vault_upgrade`, `enos/modules/verify_secrets_engines`), and all authored HCL passed
`terraform fmt -check` and all authored shell scripts passed `bash -n`; a first live run against
real infrastructure is the remaining verification step before relying on the measured-under-30-
minutes claim operationally.
