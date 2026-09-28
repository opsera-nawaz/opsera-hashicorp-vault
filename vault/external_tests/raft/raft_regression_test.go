// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: BUSL-1.1

package rafttests

import (
	"fmt"
	"testing"
	"time"

	"github.com/hashicorp/vault/helper/testhelpers"
	"github.com/hashicorp/vault/vault"
	"github.com/stretchr/testify/require"
)

// TestRaft_Regression_ModernizationRollingRestart is the fast, local-dev
// analog of enos/enos-scenario-raft-regression.hcl (WO-038). It provisions a
// 5 node Raft cluster with autopilot enabled and aggressive reconcile
// intervals, then performs a one-node-at-a-time binary-swap-style rolling
// restart -- the same deployment pattern used to roll out the handler
// registry migration (WO-024) and the autoSeal->CoreAccess refactor
// (WO-015) -- and asserts that:
//
//   - AC1: zero *unplanned* leader elections occur while restarting non-leader
//     nodes one at a time,
//   - AC2: an intentional leader step-down (POST /v1/sys/step-down analog)
//     results in a new leader being elected within 30s,
//   - AC3: all 5 Raft voters are present (per GET /v1/sys/storage/raft/configuration)
//     after the full rolling restart completes,
//   - AC4: every node's GET /v1/sys/health returns 200 (active) or 429
//     (standby) after restart, and every follower unseals via the
//     testhelpers.EnsureCoreUnsealed pattern named in the AC.
//
// AC5 (HTTP 474 partition / 530 removed-from-cluster) is already exercised
// end-to-end by TestSysHealth_Raft in raft_test.go using the same
// cluster.InmemLayer.Partition() + sys/storage/raft/remove-peer pattern; this
// test does not duplicate that coverage, it is verified alongside this test
// (see WO-038 completion comment for the joint run output).
func TestRaft_Regression_ModernizationRollingRestart(t *testing.T) {
	t.Parallel()

	reconcileInterval := 5 * time.Second
	updateInterval := 2 * time.Second

	cluster, clusterOpts := raftCluster(t, &RaftClusterOpts{
		InmemCluster:    true,
		EnableAutopilot: true,
		NumCores:        5,
		PhysicalFactoryConfig: map[string]interface{}{
			"performance_multiplier":       "5",
			"autopilot_reconcile_interval": reconcileInterval.String(),
			"autopilot_update_interval":    updateInterval.String(),
		},
	})

	allNodeIDs := map[string]bool{}
	for _, core := range cluster.Cores {
		allNodeIDs[core.NodeID] = true
	}

	leader := testhelpers.WaitForActiveNode(t, cluster)
	originalLeaderNodeID := leader.NodeID

	config, err := leader.Client.Sys().RaftAutopilotConfiguration()
	require.NoError(t, err)

	// Establish the pre-restart baseline required by the AC: 5 voters, all
	// stabilized, before we start exercising failover.
	testhelpers.RetryUntil(t, 30*time.Second, func() error {
		expected := map[string]bool{}
		for id := range allNodeIDs {
			expected[id] = true
		}
		return testhelpers.VerifyRaftPeers(t, leader.Client, expected)
	})

	// --- AC2: intentional leader step-down; new leader elected within 30s ---
	stepDownStart := time.Now()
	require.NoError(t, leader.Client.Sys().StepDown())

	var currentLeader *vault.TestClusterCore
	testhelpers.RetryUntil(t, 30*time.Second, func() error {
		for _, core := range cluster.Cores {
			if core.Core.Sealed() {
				continue
			}
			resp, err := core.Client.Sys().Leader()
			if err != nil {
				continue
			}
			if resp.IsSelf && core.NodeID != originalLeaderNodeID {
				currentLeader = core
				return nil
			}
		}
		return fmt.Errorf("no new leader elected yet")
	})
	electionDuration := time.Since(stepDownStart)
	require.NotNil(t, currentLeader, "expected a new leader distinct from the original leader %s", originalLeaderNodeID)
	require.LessOrEqualf(t, electionDuration, 30*time.Second,
		"leader election after step-down took %s, want <=30s", electionDuration)
	t.Logf("AC2 evidence: leader election after step-down completed in %s (new leader node_id=%s)",
		electionDuration, currentLeader.NodeID)

	// --- AC1 + AC4: rolling restart, one node at a time (binary-swap simulation) ---
	unplannedElections := 0
	for idx, core := range cluster.Cores {
		wasLeader := core.NodeID == currentLeader.NodeID

		cluster.StopCore(t, idx)
		// Give the rest of the cluster a moment to notice the node is gone,
		// mirroring the brief unavailability window of a real binary swap.
		time.Sleep(500 * time.Millisecond)
		cluster.StartCore(t, idx, clusterOpts, false)

		// AC4: follower unsealing succeeds after restart, via the
		// EnsureCoreUnsealed pattern named in the acceptance criterion.
		testhelpers.EnsureCoreUnsealed(t, cluster, core)

		postRestartLeader := testhelpers.WaitForActiveNode(t, cluster)
		if wasLeader {
			// Restarting the active node forces a *planned* hand-off as
			// part of the rolling restart; update our reference but do not
			// count it toward the AC1 unplanned-election budget.
			currentLeader = postRestartLeader
			continue
		}
		if postRestartLeader.NodeID != currentLeader.NodeID {
			unplannedElections++
			t.Logf("unplanned leader election detected: restarting non-leader node_id=%s caused leader to change from %s to %s",
				core.NodeID, currentLeader.NodeID, postRestartLeader.NodeID)
			currentLeader = postRestartLeader
		}
	}
	require.Equal(t, 0, unplannedElections,
		"AC1: expected zero unplanned leader elections while restarting non-leader nodes during rolling restart")
	t.Logf("AC1 evidence: rolling-restarted all %d nodes with %d unplanned leader elections", len(cluster.Cores), unplannedElections)

	// --- AC3: all 5 Raft voters present after the full rolling restart ---
	testhelpers.RetryUntil(t, 2*config.ServerStabilizationTime+30*time.Second, func() error {
		expected := map[string]bool{}
		for id := range allNodeIDs {
			expected[id] = true
		}
		return testhelpers.VerifyRaftPeers(t, currentLeader.Client, expected)
	})
	t.Logf("AC3 evidence: all %d raft voters present after rolling restart", len(allNodeIDs))

	// --- AC4: GET /v1/sys/health returns 200 (active) or 429 (standby) for every node ---
	for i, core := range cluster.Cores {
		resp, err := core.Client.Logical().ReadRawWithData("sys/health", map[string][]string{
			"standbyok": {"true"},
		})
		require.NoError(t, err)
		status := resp.StatusCode
		resp.Body.Close()
		require.Truef(t, status == 200 || status == 429,
			"AC4: core %d (node_id=%s) returned unexpected sys/health status %d, want 200 or 429", i, core.NodeID, status)
	}
	t.Logf("AC4 evidence: all %d nodes returned sys/health status 200 or 429 after rolling restart", len(cluster.Cores))
}
