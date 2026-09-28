// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: BUSL-1.1

package vault

import (
	"bytes"
	"context"
	"errors"
	"reflect"
	"sync"
	"testing"
	"time"

	log "github.com/hashicorp/go-hclog"
	wrapping "github.com/hashicorp/go-kms-wrapping/v2"
	metrics "github.com/hashicorp/go-metrics/compat"
	"github.com/hashicorp/vault/internalshared/metricsutil"
	"github.com/hashicorp/vault/sdk/physical"
	"github.com/hashicorp/vault/vault/interfaces"
	"github.com/hashicorp/vault/vault/seal"
	"github.com/stretchr/testify/require"
)

// phy implements physical.Backend. It maps keys to a slice of entries.
// Each call to Put appends the entry to the slice of entries for that
// key. No deduplication is done. This allows the test for UpgradeKeys to
// verify entries are only being updated when the underlying encryption key
// has been updated.
type phy struct {
	t       *testing.T
	entries map[string][]*physical.Entry
}

var _ physical.Backend = (*phy)(nil)

func newTestBackend(t *testing.T) *phy {
	return &phy{
		t:       t,
		entries: make(map[string][]*physical.Entry),
	}
}

func (p *phy) Put(_ context.Context, entry *physical.Entry) error {
	p.entries[entry.Key] = append(p.entries[entry.Key], entry)
	return nil
}

func (p *phy) Get(_ context.Context, key string) (*physical.Entry, error) {
	entries := p.entries[key]
	if entries == nil {
		return nil, nil
	}
	return entries[len(entries)-1], nil
}

func (p *phy) Delete(_ context.Context, key string) error {
	p.t.Errorf("Delete called on phy: key: %v", key)
	return nil
}

func (p *phy) List(_ context.Context, prefix string) ([]string, error) {
	p.t.Errorf("List called on phy: prefix: %v", prefix)
	return []string{}, nil
}

func (p *phy) Len() int {
	return len(p.entries)
}

func TestAutoSeal_UpgradeKeys(t *testing.T) {
	core, _, _ := TestCoreUnsealed(t)
	testSeal, toggleableWrappers := seal.NewTestSeal(nil)

	var encKeys []string
	changeKey := func(key string) {
		encKeys = append(encKeys, key)
		toggleableWrappers[0].Wrapper.(*wrapping.TestWrapper).SetKeyId(key)
	}

	// Set initial encryption key.
	changeKey("kaz")

	autoSeal := NewAutoSeal(testSeal)
	autoSeal.SetCore(core)
	pBackend := newTestBackend(t)
	core.physical = pBackend

	ctx := context.Background()

	inkeys := [][]byte{[]byte("grist"), []byte("house")}
	if err := autoSeal.SetStoredKeys(ctx, inkeys); err != nil {
		t.Fatalf("SetStoredKeys: want no error, got %v", err)
	}

	inRecoveryKey := []byte("falernum")
	if err := autoSeal.SetRecoveryKey(ctx, inRecoveryKey); err != nil {
		t.Fatalf("SetRecoveryKey: want no error, got %v", err)
	}

	check := func() {
		// The values of the stored keys should never change.
		outkeys, err := autoSeal.GetStoredKeys(ctx)
		if err != nil {
			t.Fatalf("GetStoredKeys: want no error, got %v", err)
		}
		if !reflect.DeepEqual(inkeys, outkeys) {
			t.Errorf("incorrect stored keys: want %v, got %v", inkeys, outkeys)
		}

		// The value of the recovery key should also never change.
		outRecoveryKey, err := autoSeal.RecoveryKey(ctx)
		if err != nil {
			t.Fatalf("RecoveryKey: want no error, got %v", err)
		}
		if !bytes.Equal(inRecoveryKey, outRecoveryKey) {
			t.Errorf("incorrect recovery key: want %q, got %q", inRecoveryKey, outRecoveryKey)
		}

		// There should only be 2 entries in the physical backend. One for
		// the stored keys and one for the recovery key.
		if want, got := 2, pBackend.Len(); want != got {
			t.Errorf("backend unexpected Len: want %d, got %d", want, got)
		}

		for phyKey, phyEntries := range pBackend.entries {
			// Calling UpgradeKeys should only add an entry if the key has
			// changed.
			if keyCount, entryCount := len(encKeys), len(phyEntries); keyCount != entryCount {
				t.Errorf("phyKey = %s: encryption key count not equal to entry count: keys=%d, entries=%d", phyKey, keyCount, entryCount)
			}

			// Each phyEntry should correspond to a key at the same index
			// in encKeys. Iterate over each phyEntry and verify it was
			// encrypted with its corresponding key in encKeys.
			for i, phyEntry := range phyEntries {
				wrappedEntryValue, err := UnmarshalSealWrappedValue(phyEntry.Value)
				if err != nil {
					t.Errorf("phyKey = %s: failed to unmarshal stored keys: %s", phyKey, err)
				}
				blobInfo := wrappedEntryValue.GetSlots()[0]
				if blobInfo.KeyInfo == nil {
					t.Errorf("phyKey = %s: KeyInfo missing: %+v", phyKey, blobInfo)
				}
				if want, got := encKeys[i], blobInfo.KeyInfo.KeyId; want != got {
					t.Errorf("phyKey = %s: Incorrect encryption key: want %s, got %s", phyKey, want, got)
				}
			}
		}
	}

	// Verify the current state is correct before calling UpgradeKeys.
	check()

	// Call UpgradeKeys before changing the encryption key and verify
	// nothing has changed.
	if err := autoSeal.UpgradeKeys(ctx); err != nil {
		t.Fatalf("UpgradeKeys: want no error, got %v", err)
	}
	check()

	// Change the encryption key, call UpgradeKeys, then verify the stored
	// keys and recovery key has been re-encrypted with the new encryption
	// key.
	changeKey("primanti")
	if err := autoSeal.UpgradeKeys(ctx); err != nil {
		t.Fatalf("UpgradeKeys: want no error, got %v", err)
	}
	check()
}

func TestAutoSeal_HealthCheck(t *testing.T) {
	inmemSink := metrics.NewInmemSink(
		1000000*time.Hour,
		2000000*time.Hour)

	metricsConf := metrics.DefaultConfig("")
	metricsConf.EnableHostname = false
	metricsConf.EnableHostnameLabel = false
	metricsConf.EnableServiceLabel = false
	metricsConf.EnableTypePrefix = false

	metrics.NewGlobal(metricsConf, inmemSink)

	pBackend := newTestBackend(t)
	testSealAccess, wrappers := seal.NewTestSeal(&seal.TestSealOpts{Name: "health-test"})
	core, _, _ := TestCoreUnsealedWithConfig(t, &CoreConfig{
		MetricSink: metricsutil.NewClusterMetricSink("", inmemSink),
		Physical:   pBackend,
	})
	seal.HealthTestIntervalNominal = 10 * time.Millisecond
	seal.HealthTestIntervalUnhealthy = 10 * time.Millisecond
	autoSeal := NewAutoSeal(testSealAccess)
	autoSeal.SetCore(core)
	core.seal = autoSeal
	autoSeal.StartHealthCheck(t.Context())
	defer autoSeal.StopHealthCheck()
	wrappers[0].SetError(errors.New("disconnected"))

	tries := 10
	for tries = 10; tries > 0; tries-- {
		if !autoSeal.Healthy() {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if tries == 0 {
		t.Fatalf("Expected to detect unhealthy seals")
	}

	wrappers[0].SetError(nil)
	time.Sleep(50 * time.Millisecond)
	if !autoSeal.Healthy() {
		t.Fatal("Expected seals to be healthy")
	}
}

// mockCoreAccess is a minimal, in-memory implementation of
// interfaces.CoreAccess. It exists to prove that autoSeal depends only on
// the CoreAccess interface boundary (WO-015), not on the concrete
// *vault.Core: unlike the other tests in this file, autoSeal.SetCore below
// is never given a real *Core.
type mockCoreAccess struct {
	mu                  sync.Mutex
	logger              log.Logger
	sealed              bool
	barrierSealConfig   *interfaces.SealConfig
	recoverySealConfig  *interfaces.SealConfig
	recoverySealOldPath *interfaces.SealConfig
	physical            map[string]*interfaces.StorageEntry
	barrier             map[string]*interfaces.StorageEntry
}

var _ interfaces.CoreAccess = (*mockCoreAccess)(nil)

func newMockCoreAccess() *mockCoreAccess {
	return &mockCoreAccess{
		logger:   log.NewNullLogger(),
		physical: make(map[string]*interfaces.StorageEntry),
		barrier:  make(map[string]*interfaces.StorageEntry),
	}
}

func (m *mockCoreAccess) Logger() log.Logger {
	return m.logger
}

func (m *mockCoreAccess) AddLogger(_ log.Logger) {}

func (m *mockCoreAccess) Sealed() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sealed
}

func (m *mockCoreAccess) PhysicalBarrierSealConfig(_ context.Context) (*interfaces.SealConfig, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.barrierSealConfig, nil
}

func (m *mockCoreAccess) SetPhysicalBarrierSealConfig(_ context.Context, cfg *interfaces.SealConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.barrierSealConfig = cfg
	return nil
}

func (m *mockCoreAccess) PhysicalRecoverySealConfig(_ context.Context) (*interfaces.SealConfig, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.recoverySealConfig, nil
}

func (m *mockCoreAccess) SetPhysicalRecoverySealConfig(_ context.Context, cfg *interfaces.SealConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.recoverySealConfig = cfg
	return nil
}

func (m *mockCoreAccess) PhysicalRecoverySealConfigOldPath(_ context.Context) (*interfaces.SealConfig, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.recoverySealOldPath, nil
}

func (m *mockCoreAccess) PhysicalGet(_ context.Context, key string) (*interfaces.StorageEntry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	entry, ok := m.physical[key]
	if !ok {
		return nil, nil
	}
	return entry, nil
}

func (m *mockCoreAccess) PhysicalPut(_ context.Context, entry *interfaces.StorageEntry) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.physical[entry.Key] = entry
	return nil
}

func (m *mockCoreAccess) PhysicalDelete(_ context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.physical, key)
	return nil
}

func (m *mockCoreAccess) BarrierGet(_ context.Context, key string) (*interfaces.StorageEntry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	entry, ok := m.barrier[key]
	if !ok {
		return nil, nil
	}
	return entry, nil
}

func (m *mockCoreAccess) BarrierDelete(_ context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.barrier, key)
	return nil
}

// MetricSink returns nil: this test never exercises the seal health-check
// loop, the only autoSeal code path that reports through it.
func (m *mockCoreAccess) MetricSink() *metricsutil.ClusterMetricSink {
	return nil
}

// TestAutoSeal_MockCoreAccess exercises every autoSeal method that touches
// d.core against a from-scratch mockCoreAccess instead of a real *vault.Core,
// proving autoSeal.SetCore and the d.core.* call sites in
// vault/seal_autoseal.go compile and run against interfaces.CoreAccess alone.
func TestAutoSeal_MockCoreAccess(t *testing.T) {
	testSealAccess, _ := seal.NewTestSeal(nil)
	autoSealImpl := NewAutoSeal(testSealAccess)

	core := newMockCoreAccess()
	autoSealImpl.SetCore(core)

	ctx := context.Background()

	// Stored keys round-trip (SetStoredKeys/GetStoredKeys, which go through
	// the coreAccessPhysicalBackend adapter shared with writeStoredKeys and
	// readStoredKeys).
	inKeys := [][]byte{[]byte("share-a"), []byte("share-b")}
	require.NoError(t, autoSealImpl.SetStoredKeys(ctx, inKeys))
	outKeys, err := autoSealImpl.GetStoredKeys(ctx)
	require.NoError(t, err)
	require.Equal(t, inKeys, outKeys)

	// Recovery key round-trip (SetRecoveryKey/RecoveryKey/VerifyRecoveryKey,
	// which go through PhysicalPut/PhysicalGet directly).
	require.NoError(t, autoSealImpl.SetRecoveryKey(ctx, []byte("recovery-key")))
	gotRecoveryKey, err := autoSealImpl.RecoveryKey(ctx)
	require.NoError(t, err)
	require.Equal(t, []byte("recovery-key"), gotRecoveryKey)
	require.NoError(t, autoSealImpl.VerifyRecoveryKey(ctx, []byte("recovery-key")))
	require.Error(t, autoSealImpl.VerifyRecoveryKey(ctx, []byte("wrong-key")))

	// Barrier config round-trip (SetBarrierConfig/BarrierConfig, which go
	// through SetPhysicalBarrierSealConfig/PhysicalBarrierSealConfig).
	bc := &SealConfig{SecretShares: 5, SecretThreshold: 3}
	require.NoError(t, autoSealImpl.SetBarrierConfig(ctx, bc))
	gotBc, err := autoSealImpl.BarrierConfig(ctx)
	require.NoError(t, err)
	require.Equal(t, bc.SecretShares, gotBc.SecretShares)
	require.Equal(t, bc.SecretThreshold, gotBc.SecretThreshold)

	// A second autoSeal instance sharing the same mock core, with its own
	// empty cache, must read the config back through
	// d.core.PhysicalBarrierSealConfig rather than a cache hit.
	autoSealImpl2 := NewAutoSeal(testSealAccess)
	autoSealImpl2.SetCore(core)
	gotBc2, err := autoSealImpl2.BarrierConfig(ctx)
	require.NoError(t, err)
	require.Equal(t, bc.SecretShares, gotBc2.SecretShares)

	// Recovery config round-trip (SetRecoveryConfig/RecoveryConfig, which
	// also exercises migrateRecoveryConfig's BarrierGet/BarrierDelete path;
	// it's a no-op here since the mock's barrier map starts empty).
	rc := &SealConfig{SecretShares: 5, SecretThreshold: 3}
	require.NoError(t, autoSealImpl.SetRecoveryConfig(ctx, rc))
	gotRc, err := autoSealImpl.RecoveryConfig(ctx)
	require.NoError(t, err)
	require.Equal(t, rc.SecretShares, gotRc.SecretShares)

	// Initialization flag round-trip (SetInitializationFlag/
	// ClearInitializationFlag/IsInitializationFlagSet, which go through the
	// coreAccessPhysicalBackend adapter).
	require.NoError(t, autoSealImpl.SetInitializationFlag(ctx))
	set, err := autoSealImpl.IsInitializationFlagSet(ctx)
	require.NoError(t, err)
	require.True(t, set)
	require.NoError(t, autoSealImpl.ClearInitializationFlag(ctx))
	set, err = autoSealImpl.IsInitializationFlagSet(ctx)
	require.NoError(t, err)
	require.False(t, set)
}

func TestAutoSeal_BarrierSealConfigType(t *testing.T) {
	singleWrapperAccess, _ := seal.NewTestSeal(&seal.TestSealOpts{WrapperCount: 1})
	multipleWrapperAccess, _ := seal.NewTestSeal(&seal.TestSealOpts{WrapperCount: 2})

	require.Equalf(t, singleWrapperAccess.GetAllSealWrappersByPriority()[0].SealConfigType, NewAutoSeal(singleWrapperAccess).BarrierSealConfigType().String(),
		"autoseals that have a single seal wrapper report that wrapper's as the barrier seal type")

	require.Equalf(t, SealConfigTypeMultiseal, NewAutoSeal(multipleWrapperAccess).BarrierSealConfigType(),
		"autoseals that have a multiple seal wrappers report the barrier seal type as Multiseal")
}
