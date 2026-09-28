// Copyright IBM Corp. 2026
// SPDX-License-Identifier: BUSL-1.1

package interfaces

import (
	"context"
	"errors"
	"testing"

	log "github.com/hashicorp/go-hclog"
	wrapping "github.com/hashicorp/go-kms-wrapping/v2"
	"github.com/stretchr/testify/require"

	"github.com/hashicorp/vault/internalshared/metricsutil"
)

// MockCryptoBarrier is a minimal in-memory CryptoBarrier used to prove the
// interface is satisfiable by a concrete type.
type MockCryptoBarrier struct {
	store       map[string][]byte
	rotateCalls int
}

var _ CryptoBarrier = (*MockCryptoBarrier)(nil)

func NewMockCryptoBarrier() *MockCryptoBarrier {
	return &MockCryptoBarrier{store: make(map[string][]byte)}
}

func (m *MockCryptoBarrier) Encrypt(_ context.Context, key string, plaintext []byte) ([]byte, error) {
	ciphertext := append([]byte(nil), plaintext...)
	m.store[key] = ciphertext
	return ciphertext, nil
}

func (m *MockCryptoBarrier) Decrypt(_ context.Context, key string, ciphertext []byte) ([]byte, error) {
	stored, ok := m.store[key]
	if !ok {
		return nil, errors.New("mock: no such key")
	}
	if string(stored) != string(ciphertext) {
		return nil, errors.New("mock: ciphertext mismatch")
	}
	return append([]byte(nil), ciphertext...), nil
}

func (m *MockCryptoBarrier) RotateKey(_ context.Context) error {
	m.rotateCalls++
	return nil
}

// MockSealAccess is a minimal SealAccess used to prove the interface is
// satisfiable by a concrete type, including its embedded
// wrapping.InitFinalizer methods.
type MockSealAccess struct {
	sealType   string
	core       CoreAccess
	verifyErr  error
	initCalls  int
	finalCalls int
}

var _ SealAccess = (*MockSealAccess)(nil)

func NewMockSealAccess(sealType string) *MockSealAccess {
	return &MockSealAccess{sealType: sealType}
}

func (m *MockSealAccess) Init(_ context.Context, _ ...wrapping.Option) error {
	m.initCalls++
	return nil
}

func (m *MockSealAccess) Finalize(_ context.Context, _ ...wrapping.Option) error {
	m.finalCalls++
	return nil
}

func (m *MockSealAccess) GetSealType() string {
	return m.sealType
}

func (m *MockSealAccess) Verify(_ context.Context) error {
	return m.verifyErr
}

func (m *MockSealAccess) SetCore(core CoreAccess) {
	m.core = core
}

// MockCoreAccess is a minimal in-memory CoreAccess used to prove the
// interface is satisfiable by a concrete type, mirroring the d.core.* call
// sites in vault/seal_autoseal.go.
type MockCoreAccess struct {
	logger              log.Logger
	sealed              bool
	barrierSealConfig   *SealConfig
	recoverySealConfig  *SealConfig
	recoverySealOldPath *SealConfig
	physical            map[string]*StorageEntry
	barrier             map[string]*StorageEntry
}

var _ CoreAccess = (*MockCoreAccess)(nil)

func NewMockCoreAccess() *MockCoreAccess {
	return &MockCoreAccess{
		logger:   log.NewNullLogger(),
		sealed:   true,
		physical: make(map[string]*StorageEntry),
		barrier:  make(map[string]*StorageEntry),
	}
}

func (m *MockCoreAccess) Logger() log.Logger {
	return m.logger
}

func (m *MockCoreAccess) AddLogger(logger log.Logger) {
	m.logger = m.logger.With("added-by", logger.Name())
}

func (m *MockCoreAccess) Sealed() bool {
	return m.sealed
}

func (m *MockCoreAccess) PhysicalBarrierSealConfig(_ context.Context) (*SealConfig, error) {
	return m.barrierSealConfig, nil
}

func (m *MockCoreAccess) SetPhysicalBarrierSealConfig(_ context.Context, barrierSealConfig *SealConfig) error {
	m.barrierSealConfig = barrierSealConfig
	return nil
}

func (m *MockCoreAccess) PhysicalRecoverySealConfig(_ context.Context) (*SealConfig, error) {
	return m.recoverySealConfig, nil
}

func (m *MockCoreAccess) SetPhysicalRecoverySealConfig(_ context.Context, recoverySealConfig *SealConfig) error {
	m.recoverySealConfig = recoverySealConfig
	return nil
}

func (m *MockCoreAccess) PhysicalRecoverySealConfigOldPath(_ context.Context) (*SealConfig, error) {
	// Mirrors the real migration edge case: no entry at the legacy path
	// once a cluster has migrated returns (nil, nil).
	return m.recoverySealOldPath, nil
}

func (m *MockCoreAccess) PhysicalGet(_ context.Context, key string) (*StorageEntry, error) {
	entry, ok := m.physical[key]
	if !ok {
		return nil, nil
	}
	return entry, nil
}

func (m *MockCoreAccess) PhysicalPut(_ context.Context, entry *StorageEntry) error {
	m.physical[entry.Key] = entry
	return nil
}

func (m *MockCoreAccess) PhysicalDelete(_ context.Context, key string) error {
	delete(m.physical, key)
	return nil
}

func (m *MockCoreAccess) BarrierGet(_ context.Context, key string) (*StorageEntry, error) {
	entry, ok := m.barrier[key]
	if !ok {
		return nil, nil
	}
	return entry, nil
}

func (m *MockCoreAccess) BarrierDelete(_ context.Context, key string) error {
	delete(m.barrier, key)
	return nil
}

// MetricSink returns nil: none of the CoreAccess mock's exercises touch
// seal-availability metrics reporting.
func (m *MockCoreAccess) MetricSink() *metricsutil.ClusterMetricSink {
	return nil
}

func TestMockCryptoBarrier_EncryptDecryptRotate(t *testing.T) {
	ctx := context.Background()
	barrier := NewMockCryptoBarrier()

	ciphertext, err := barrier.Encrypt(ctx, "my-key", []byte("plaintext"))
	require.NoError(t, err)

	plaintext, err := barrier.Decrypt(ctx, "my-key", ciphertext)
	require.NoError(t, err)
	require.Equal(t, []byte("plaintext"), plaintext)

	require.NoError(t, barrier.RotateKey(ctx))
	require.Equal(t, 1, barrier.rotateCalls)

	_, err = barrier.Decrypt(ctx, "unknown-key", []byte("x"))
	require.Error(t, err)
}

func TestMockSealAccess_LifecycleAndCoreWiring(t *testing.T) {
	ctx := context.Background()
	seal := NewMockSealAccess("shamir")
	core := NewMockCoreAccess()

	require.Equal(t, "shamir", seal.GetSealType())
	require.NoError(t, seal.Init(ctx))
	require.NoError(t, seal.Verify(ctx))
	require.NoError(t, seal.Finalize(ctx))
	require.Equal(t, 1, seal.initCalls)
	require.Equal(t, 1, seal.finalCalls)

	seal.SetCore(core)
	require.Same(t, core, seal.core)
}

func TestMockCoreAccess_SealConfigAndPhysicalAccessors(t *testing.T) {
	ctx := context.Background()
	core := NewMockCoreAccess()

	require.True(t, core.Sealed())

	barrierCfg := &SealConfig{Type: "shamir", SecretShares: 5, SecretThreshold: 3}
	require.NoError(t, core.SetPhysicalBarrierSealConfig(ctx, barrierCfg))
	gotBarrierCfg, err := core.PhysicalBarrierSealConfig(ctx)
	require.NoError(t, err)
	require.Equal(t, barrierCfg, gotBarrierCfg)

	recoveryCfg := &SealConfig{Type: "shamir", SecretShares: 5, SecretThreshold: 3}
	require.NoError(t, core.SetPhysicalRecoverySealConfig(ctx, recoveryCfg))
	gotRecoveryCfg, err := core.PhysicalRecoverySealConfig(ctx)
	require.NoError(t, err)
	require.Equal(t, recoveryCfg, gotRecoveryCfg)

	// Edge case: migration scenario where no entry exists at the legacy
	// recovery-config path must be representable as (nil, nil), not an
	// error.
	oldPathCfg, err := core.PhysicalRecoverySealConfigOldPath(ctx)
	require.NoError(t, err)
	require.Nil(t, oldPathCfg)

	entry := &StorageEntry{Key: "core/keyring", Value: []byte("data")}
	core.physical[entry.Key] = entry

	gotEntry, err := core.PhysicalGet(ctx, "core/keyring")
	require.NoError(t, err)
	require.Equal(t, entry, gotEntry)

	require.NoError(t, core.PhysicalDelete(ctx, "core/keyring"))
	gotEntry, err = core.PhysicalGet(ctx, "core/keyring")
	require.NoError(t, err)
	require.Nil(t, gotEntry)
}
