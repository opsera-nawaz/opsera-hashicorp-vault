// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: MPL-2.0

package keysutil

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	mathrand "math/rand"
	"reflect"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hashicorp/vault/sdk/helper/cryptoutil"
	"github.com/hashicorp/vault/sdk/helper/errutil"
	"github.com/hashicorp/vault/sdk/helper/jsonutil"
	"github.com/hashicorp/vault/sdk/logical"
	"github.com/mitchellh/copystructure"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/ed25519"
)

// Ordering of these items needs to match the iota order defined in policy.go. Ordering changes
// should never occur, as it would lead to a key type change within existing stored policies.
var allTestKeyTypes = []KeyType{
	KeyType_AES256_GCM96, KeyType_ECDSA_P256, KeyType_ED25519, KeyType_RSA2048,
	KeyType_RSA4096, KeyType_ChaCha20_Poly1305, KeyType_ECDSA_P384, KeyType_ECDSA_P521, KeyType_AES128_GCM96,
	KeyType_RSA3072, KeyType_MANAGED_KEY, KeyType_HMAC, KeyType_AES128_CMAC, KeyType_AES256_CMAC, KeyType_ML_DSA,
	KeyType_HYBRID, KeyType_AES192_CMAC, KeyType_SLH_DSA, KeyType_AES128_CBC, KeyType_AES256_CBC,
}

func TestPolicy_KeyTypes(t *testing.T) {
	// Make sure the iota value never change for key types, as existing storage would be affected
	for i, keyType := range allTestKeyTypes {
		if int(keyType) != i {
			t.Fatalf("iota of keytype %s changed, expected %d got %d", keyType.String(), i, keyType)
		}
	}

	// Make sure we have a string presentation for all types
	for _, keyType := range allTestKeyTypes {
		if strings.Contains(keyType.String(), "unknown") {
			t.Fatalf("keytype with iota of %d should not contain 'unknown', missing in String() switch statement", keyType)
		}
	}
}

func TestPolicy_HmacCmacSupported(t *testing.T) {
	// Test HMAC supported feature
	for _, keyType := range allTestKeyTypes {
		switch keyType {
		case KeyType_MANAGED_KEY:
			if keyType.HMACSupported() {
				t.Fatalf("hmac should not have been not be supported for keytype %s", keyType.String())
			}
			if keyType.CMACSupported() {
				t.Fatalf("cmac should not have been be supported for keytype %s", keyType.String())
			}
		case KeyType_AES128_CMAC, KeyType_AES256_CMAC, KeyType_AES192_CMAC:
			if keyType.HMACSupported() {
				t.Fatalf("hmac should have been not be supported for keytype %s", keyType.String())
			}
			if !keyType.CMACSupported() {
				t.Fatalf("cmac should have been be supported for keytype %s", keyType.String())
			}
		default:
			if !keyType.HMACSupported() {
				t.Fatalf("hmac should have been supported for keytype %s", keyType.String())
			}
			if keyType.CMACSupported() {
				t.Fatalf("cmac should not have been supported for keytype %s", keyType.String())
			}
		}
	}
}

func TestKeyType_KeyUsages(t *testing.T) {
	tests := []struct {
		keyType  KeyType
		expected []string
	}{
		{KeyType_AES256_GCM96, []string{"aead-encryption"}},
		{KeyType_AES128_GCM96, []string{"aead-encryption"}},
		{KeyType_ChaCha20_Poly1305, []string{"aead-encryption"}},
		{KeyType_AES128_CBC, []string{"symmetric-encryption"}},
		{KeyType_AES256_CBC, []string{"symmetric-encryption"}},
		{KeyType_ECDSA_P256, []string{"digital-signature"}},
		{KeyType_ECDSA_P384, []string{"digital-signature"}},
		{KeyType_ECDSA_P521, []string{"digital-signature"}},
		{KeyType_ED25519, []string{"digital-signature"}},
		{KeyType_ML_DSA, []string{"digital-signature"}},
		{KeyType_SLH_DSA, []string{"digital-signature"}},
		{KeyType_HYBRID, []string{"digital-signature"}},
		{KeyType_RSA2048, []string{"asymmetric-encryption", "digital-signature"}},
		{KeyType_RSA3072, []string{"asymmetric-encryption", "digital-signature"}},
		{KeyType_RSA4096, []string{"asymmetric-encryption", "digital-signature"}},
		{KeyType_HMAC, []string{"message-authentication"}},
		{KeyType_AES128_CMAC, []string{"message-authentication"}},
		{KeyType_AES192_CMAC, []string{"message-authentication"}},
		{KeyType_AES256_CMAC, []string{"message-authentication"}},
		{KeyType_MANAGED_KEY, []string{}},
	}

	for _, tt := range tests {
		t.Run(tt.keyType.String(), func(t *testing.T) {
			got := tt.keyType.KeyUsages()
			if !reflect.DeepEqual(got, tt.expected) {
				t.Errorf("KeyType(%s).KeyUsages() = %v, want %v", tt.keyType.String(), got, tt.expected)
			}
		})
	}
}

func TestPolicy_CMACKeyUpgrade(t *testing.T) {
	ctx := context.Background()
	lm, _ := NewLockManager(false, 0)
	storage := &logical.InmemStorage{}
	p, upserted, err := lm.GetPolicy(ctx, PolicyRequest{
		Upsert:  true,
		Storage: storage,
		KeyType: KeyType_AES256_CMAC,
		Name:    "test",
	}, rand.Reader)
	if err != nil {
		t.Fatalf("failed loading policy: %v", err)
	}
	if p == nil {
		t.Fatal("nil policy")
	}
	if !upserted {
		t.Fatal("expected an upsert")
	}

	// This verifies we don't have a hmac key
	_, err = p.HMACKey(1)
	if err == nil {
		t.Fatal("cmac key should not return an hmac key but did on initial creation")
	}

	if p.NeedsUpgrade() {
		t.Fatal("cmac key should not require an upgrade after initial key creation")
	}

	err = p.Upgrade(ctx, storage, rand.Reader)
	if err != nil {
		t.Fatalf("an error was returned from upgrade method: %v", err)
	}
	p.Unlock()

	// Now reload our policy from disk and make sure we still don't have a hmac key
	p, upserted, err = lm.GetPolicy(ctx, PolicyRequest{
		Upsert:  true,
		Storage: storage,
		KeyType: KeyType_AES256_CMAC,
		Name:    "test",
	}, rand.Reader)
	if err != nil {
		t.Fatalf("failed loading policy: %v", err)
	}
	if p == nil {
		t.Fatal("nil policy")
	}
	if upserted {
		t.Fatal("expected the key to exist but upserted was true")
	}

	p.Unlock()

	_, err = p.HMACKey(1)
	if err == nil {
		t.Fatal("cmac key should not return an hmac key post upgrade")
	}
}

func TestPolicy_KeyEntryMapUpgrade(t *testing.T) {
	now := time.Now()
	old := map[int]KeyEntry{
		1: {
			Key:                []byte("samplekey"),
			HMACKey:            []byte("samplehmackey"),
			CreationTime:       now,
			FormattedPublicKey: "sampleformattedpublickey",
		},
		2: {
			Key:                []byte("samplekey2"),
			HMACKey:            []byte("samplehmackey2"),
			CreationTime:       now.Add(10 * time.Second),
			FormattedPublicKey: "sampleformattedpublickey2",
		},
	}

	oldEncoded, err := jsonutil.EncodeJSON(old)
	if err != nil {
		t.Fatal(err)
	}

	var new keyEntryMap
	err = jsonutil.DecodeJSON(oldEncoded, &new)
	if err != nil {
		t.Fatal(err)
	}

	newEncoded, err := jsonutil.EncodeJSON(&new)
	if err != nil {
		t.Fatal(err)
	}

	if string(oldEncoded) != string(newEncoded) {
		t.Fatalf("failed to upgrade key entry map;\nold: %q\nnew: %q", string(oldEncoded), string(newEncoded))
	}
}

func Test_KeyUpgrade(t *testing.T) {
	lockManagerWithCache, _ := NewLockManager(true, 0)
	lockManagerWithoutCache, _ := NewLockManager(false, 0)
	testKeyUpgradeCommon(t, lockManagerWithCache)
	testKeyUpgradeCommon(t, lockManagerWithoutCache)
}

func testKeyUpgradeCommon(t *testing.T, lm *LockManager) {
	ctx := context.Background()

	storage := &logical.InmemStorage{}
	p, upserted, err := lm.GetPolicy(ctx, PolicyRequest{
		Upsert:  true,
		Storage: storage,
		KeyType: KeyType_AES256_GCM96,
		Name:    "test",
	}, rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if p == nil {
		t.Fatal("nil policy")
	}
	if !upserted {
		t.Fatal("expected an upsert")
	}
	p.Unlock()

	testBytes := make([]byte, len(p.Keys["1"].Key))
	copy(testBytes, p.Keys["1"].Key)

	p.Key = p.Keys["1"].Key
	p.Keys = nil
	p.MigrateKeyToKeysMap()
	if p.Key != nil {
		t.Fatal("policy.Key is not nil")
	}
	if len(p.Keys) != 1 {
		t.Fatal("policy.Keys is the wrong size")
	}
	if !reflect.DeepEqual(testBytes, p.Keys["1"].Key) {
		t.Fatal("key mismatch")
	}
}

func Test_ArchivingUpgrade(t *testing.T) {
	lockManagerWithCache, _ := NewLockManager(true, 0)
	lockManagerWithoutCache, _ := NewLockManager(false, 0)
	testArchivingUpgradeCommon(t, lockManagerWithCache)
	testArchivingUpgradeCommon(t, lockManagerWithoutCache)
}

func testArchivingUpgradeCommon(t *testing.T, lm *LockManager) {
	ctx := context.Background()

	// First, we generate a policy and rotate it a number of times. Each time
	// we'll ensure that we have the expected number of keys in the archive and
	// the main keys object, which without changing the min version should be
	// zero and latest, respectively

	storage := &logical.InmemStorage{}
	p, _, err := lm.GetPolicy(ctx, PolicyRequest{
		Upsert:  true,
		Storage: storage,
		KeyType: KeyType_AES256_GCM96,
		Name:    "test",
	}, rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if p == nil {
		t.Fatal("nil policy")
	}
	p.Unlock()

	// Store the initial key in the archive
	keysArchive := []KeyEntry{{}, p.Keys["1"]}
	checkKeys(t, ctx, p, storage, keysArchive, "initial", 1, 1, 1)

	for i := 2; i <= 10; i++ {
		err = p.Rotate(ctx, storage, rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		keysArchive = append(keysArchive, p.Keys[strconv.Itoa(i)])
		checkKeys(t, ctx, p, storage, keysArchive, "rotate", i, i, i)
	}

	// Now, wipe the archive and set the archive version to zero
	err = storage.Delete(ctx, "archive/test")
	if err != nil {
		t.Fatal(err)
	}
	p.ArchiveVersion = 0

	// Store it, but without calling persist, so we don't trigger
	// handleArchiving()
	buf, err := p.Serialize()
	if err != nil {
		t.Fatal(err)
	}

	// Write the policy into storage
	err = storage.Put(ctx, &logical.StorageEntry{
		Key:   "policy/" + p.Name,
		Value: buf,
	})
	if err != nil {
		t.Fatal(err)
	}

	// If we're caching, expire from the cache since we modified it
	// under-the-hood
	if lm.useCache {
		lm.cache.Delete("test")
	}

	// Now get the policy again; the upgrade should happen automatically
	p, _, err = lm.GetPolicy(ctx, PolicyRequest{
		Storage: storage,
		Name:    "test",
	}, rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if p == nil {
		t.Fatal("nil policy")
	}
	p.Unlock()

	checkKeys(t, ctx, p, storage, keysArchive, "upgrade", 10, 10, 10)

	// Let's check some deletion logic while we're at it

	// The policy should be in there
	if lm.useCache {
		_, ok := lm.cache.Load("test")
		if !ok {
			t.Fatal("nil policy in cache")
		}
	}

	// First we'll do this wrong, by not setting the deletion flag
	err = lm.DeletePolicy(ctx, storage, "test")
	if err == nil {
		t.Fatal("got nil error, but should not have been able to delete since we didn't set the deletion flag on the policy")
	}

	// The policy should still be in there
	if lm.useCache {
		_, ok := lm.cache.Load("test")
		if !ok {
			t.Fatal("nil policy in cache")
		}
	}

	p, _, err = lm.GetPolicy(ctx, PolicyRequest{
		Storage: storage,
		Name:    "test",
	}, rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if p == nil {
		t.Fatal("policy nil after bad delete")
	}
	p.Unlock()

	// Now do it properly
	p.DeletionAllowed = true
	err = p.Persist(ctx, storage)
	if err != nil {
		t.Fatal(err)
	}
	err = lm.DeletePolicy(ctx, storage, "test")
	if err != nil {
		t.Fatal(err)
	}

	// The policy should *not* be in there
	if lm.useCache {
		_, ok := lm.cache.Load("test")
		if ok {
			t.Fatal("non-nil policy in cache")
		}
	}

	p, _, err = lm.GetPolicy(ctx, PolicyRequest{
		Storage: storage,
		Name:    "test",
	}, rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if p != nil {
		t.Fatal("policy not nil after delete")
	}
}

func Test_Archiving(t *testing.T) {
	lockManagerWithCache, _ := NewLockManager(true, 0)
	lockManagerWithoutCache, _ := NewLockManager(false, 0)
	testArchivingCommon(t, lockManagerWithCache)
	testArchivingCommon(t, lockManagerWithoutCache)
}

func testArchivingCommon(t *testing.T, lm *LockManager) {
	ctx := context.Background()

	// First, we generate a policy and rotate it a number of times. Each time
	// we'll ensure that we have the expected number of keys in the archive and
	// the main keys object, which without changing the min version should be
	// zero and latest, respectively

	storage := &logical.InmemStorage{}
	p, _, err := lm.GetPolicy(ctx, PolicyRequest{
		Upsert:  true,
		Storage: storage,
		KeyType: KeyType_AES256_GCM96,
		Name:    "test",
	}, rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if p == nil {
		t.Fatal("nil policy")
	}
	p.Unlock()

	// Store the initial key in the archive
	keysArchive := []KeyEntry{{}, p.Keys["1"]}
	checkKeys(t, ctx, p, storage, keysArchive, "initial", 1, 1, 1)

	for i := 2; i <= 10; i++ {
		err = p.Rotate(ctx, storage, rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		keysArchive = append(keysArchive, p.Keys[strconv.Itoa(i)])
		checkKeys(t, ctx, p, storage, keysArchive, "rotate", i, i, i)
	}

	// Move the min decryption version up
	for i := 1; i <= 10; i++ {
		p.MinDecryptionVersion = i

		err = p.Persist(ctx, storage)
		if err != nil {
			t.Fatal(err)
		}
		// We expect to find:
		// * The keys in archive are the same as the latest version
		// * The latest version is constant
		// * The number of keys in the policy itself is from the min
		// decryption version up to the latest version, so for e.g. 7 and
		// 10, you'd need 7, 8, 9, and 10 -- IOW, latest version - min
		// decryption version plus 1 (the min decryption version key
		// itself)
		checkKeys(t, ctx, p, storage, keysArchive, "minadd", 10, 10, p.LatestVersion-p.MinDecryptionVersion+1)
	}

	// Move the min decryption version down
	for i := 10; i >= 1; i-- {
		p.MinDecryptionVersion = i

		err = p.Persist(ctx, storage)
		if err != nil {
			t.Fatal(err)
		}
		// We expect to find:
		// * The keys in archive are never removed so same as the latest version
		// * The latest version is constant
		// * The number of keys in the policy itself is from the min
		// decryption version up to the latest version, so for e.g. 7 and
		// 10, you'd need 7, 8, 9, and 10 -- IOW, latest version - min
		// decryption version plus 1 (the min decryption version key
		// itself)
		checkKeys(t, ctx, p, storage, keysArchive, "minsub", 10, 10, p.LatestVersion-p.MinDecryptionVersion+1)
	}
}

func checkKeys(t *testing.T,
	ctx context.Context,
	p *Policy,
	storage logical.Storage,
	keysArchive []KeyEntry,
	action string,
	archiveVer, latestVer, keysSize int,
) {
	// Sanity check
	if len(keysArchive) != latestVer+1 {
		t.Fatalf("latest expected key version is %d, expected test keys archive size is %d, "+
			"but keys archive is of size %d", latestVer, latestVer+1, len(keysArchive))
	}

	archive, err := p.LoadArchive(ctx, storage)
	if err != nil {
		t.Fatal(err)
	}

	badArchiveVer := false
	if archiveVer == 0 {
		if len(archive.Keys) != 0 || p.ArchiveVersion != 0 {
			badArchiveVer = true
		}
	} else {
		// We need to subtract one because we have the indexes match key
		// versions, which start at 1. So for an archive version of 1, we
		// actually have two entries -- a blank 0 entry, and the key at spot 1
		if archiveVer != len(archive.Keys)-1 || archiveVer != p.ArchiveVersion {
			badArchiveVer = true
		}
	}
	if badArchiveVer {
		t.Fatalf(
			"expected archive version %d, found length of archive keys %d and policy archive version %d",
			archiveVer, len(archive.Keys), p.ArchiveVersion,
		)
	}

	if latestVer != p.LatestVersion {
		t.Fatalf(
			"expected latest version %d, found %d",
			latestVer, p.LatestVersion,
		)
	}

	if keysSize != len(p.Keys) {
		t.Fatalf(
			"expected keys size %d, found %d, action is %s, policy is \n%#v\n",
			keysSize, len(p.Keys), action, p,
		)
	}

	for i := p.MinDecryptionVersion; i <= p.LatestVersion; i++ {
		if _, ok := p.Keys[strconv.Itoa(i)]; !ok {
			t.Fatalf(
				"expected key %d, did not find it in policy keys", i,
			)
		}
	}

	for i := p.MinDecryptionVersion; i <= p.LatestVersion; i++ {
		ver := strconv.Itoa(i)
		if !p.Keys[ver].CreationTime.Equal(keysArchive[i].CreationTime) {
			t.Fatalf("key %d not equivalent between policy keys and test keys archive; policy keys:\n%#v\ntest keys archive:\n%#v\n", i, p.Keys[ver], keysArchive[i])
		}
		polKey := p.Keys[ver]
		polKey.CreationTime = keysArchive[i].CreationTime
		p.Keys[ver] = polKey
		if !reflect.DeepEqual(p.Keys[ver], keysArchive[i]) {
			t.Fatalf("key %d not equivalent between policy keys and test keys archive; policy keys:\n%#v\ntest keys archive:\n%#v\n", i, p.Keys[ver], keysArchive[i])
		}
	}

	for i := 1; i < len(archive.Keys); i++ {
		if !reflect.DeepEqual(archive.Keys[i].Key, keysArchive[i].Key) {
			t.Fatalf("key %d not equivalent between policy archive and test keys archive; policy archive:\n%#v\ntest keys archive:\n%#v\n", i, archive.Keys[i].Key, keysArchive[i].Key)
		}
	}
}

func Test_StorageErrorSafety(t *testing.T) {
	ctx := context.Background()
	lm, _ := NewLockManager(true, 0)

	storage := &logical.InmemStorage{}
	p, _, err := lm.GetPolicy(ctx, PolicyRequest{
		Upsert:  true,
		Storage: storage,
		KeyType: KeyType_AES256_GCM96,
		Name:    "test",
	}, rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if p == nil {
		t.Fatal("nil policy")
	}
	defer p.Unlock()

	// Store the initial key in the archive
	keysArchive := []KeyEntry{{}, p.Keys["1"]}
	checkKeys(t, ctx, p, storage, keysArchive, "initial", 1, 1, 1)

	// We use checkKeys here just for sanity; it doesn't really handle cases of
	// errors below so we do more targeted testing later
	for i := 2; i <= 5; i++ {
		err = p.Rotate(ctx, storage, rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		keysArchive = append(keysArchive, p.Keys[strconv.Itoa(i)])
		checkKeys(t, ctx, p, storage, keysArchive, "rotate", i, i, i)
	}

	underlying := storage.Underlying()
	underlying.FailPut(true)

	priorLen := len(p.Keys)

	err = p.Rotate(ctx, storage, rand.Reader)
	if err == nil {
		t.Fatal("expected error")
	}

	if len(p.Keys) != priorLen {
		t.Fatal("length of keys should not have changed")
	}
}

func Test_BadUpgrade(t *testing.T) {
	ctx := context.Background()
	lm, _ := NewLockManager(true, 0)
	storage := &logical.InmemStorage{}
	p, _, err := lm.GetPolicy(ctx, PolicyRequest{
		Upsert:  true,
		Storage: storage,
		KeyType: KeyType_AES256_GCM96,
		Name:    "test",
	}, rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if p == nil {
		t.Fatal("nil policy")
	}
	defer p.Unlock()

	orig, err := copystructure.Copy(p)
	if err != nil {
		t.Fatal(err)
	}
	orig.(*Policy).l = p.l

	p.Key = p.Keys["1"].Key
	p.Keys = nil
	p.MinDecryptionVersion = 0

	if err := p.Upgrade(ctx, storage, rand.Reader); err != nil {
		t.Fatal(err)
	}

	k := p.Keys["1"]
	o := orig.(*Policy).Keys["1"]
	k.CreationTime = o.CreationTime
	k.HMACKey = o.HMACKey
	p.Keys["1"] = k
	p.versionPrefixCache = sync.Map{}

	if !reflect.DeepEqual(orig, p) {
		t.Fatalf("not equal:\n%#v\n%#v", orig, p)
	}

	// Do it again with a failing storage call
	underlying := storage.Underlying()
	underlying.FailPut(true)

	p.Key = p.Keys["1"].Key
	p.Keys = nil
	p.MinDecryptionVersion = 0

	if err := p.Upgrade(ctx, storage, rand.Reader); err == nil {
		t.Fatal("expected error")
	}

	if p.MinDecryptionVersion == 1 {
		t.Fatal("min decryption version was changed")
	}
	if p.Keys != nil {
		t.Fatal("found upgraded keys")
	}
	if p.Key == nil {
		t.Fatal("non-upgraded key not found")
	}
}

func Test_BadArchive(t *testing.T) {
	ctx := context.Background()
	lm, _ := NewLockManager(true, 0)
	storage := &logical.InmemStorage{}
	p, _, err := lm.GetPolicy(ctx, PolicyRequest{
		Upsert:  true,
		Storage: storage,
		KeyType: KeyType_AES256_GCM96,
		Name:    "test",
	}, rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if p == nil {
		t.Fatal("nil policy")
	}
	defer p.Unlock()

	for i := 2; i <= 10; i++ {
		err = p.Rotate(ctx, storage, rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
	}

	p.MinDecryptionVersion = 5
	if err := p.Persist(ctx, storage); err != nil {
		t.Fatal(err)
	}
	if p.ArchiveVersion != 10 {
		t.Fatalf("unexpected archive version %d", p.ArchiveVersion)
	}
	if len(p.Keys) != 6 {
		t.Fatalf("unexpected key length %d", len(p.Keys))
	}

	// Set back
	p.MinDecryptionVersion = 1
	if err := p.Persist(ctx, storage); err != nil {
		t.Fatal(err)
	}
	if p.ArchiveVersion != 10 {
		t.Fatalf("unexpected archive version %d", p.ArchiveVersion)
	}
	if len(p.Keys) != 10 {
		t.Fatalf("unexpected key length %d", len(p.Keys))
	}

	// Run it again but we'll turn off storage along the way
	p.MinDecryptionVersion = 5
	if err := p.Persist(ctx, storage); err != nil {
		t.Fatal(err)
	}
	if p.ArchiveVersion != 10 {
		t.Fatalf("unexpected archive version %d", p.ArchiveVersion)
	}
	if len(p.Keys) != 6 {
		t.Fatalf("unexpected key length %d", len(p.Keys))
	}

	underlying := storage.Underlying()
	underlying.FailPut(true)

	// Set back, which should cause p.Keys to be changed if the persist works,
	// but it doesn't
	p.MinDecryptionVersion = 1
	if err := p.Persist(ctx, storage); err == nil {
		t.Fatal("expected error during put")
	}
	if p.ArchiveVersion != 10 {
		t.Fatalf("unexpected archive version %d", p.ArchiveVersion)
	}
	// Here's the expected change
	if len(p.Keys) != 6 {
		t.Fatalf("unexpected key length %d", len(p.Keys))
	}
}

func Test_Import(t *testing.T) {
	ctx := context.Background()
	storage := &logical.InmemStorage{}
	testKeys, err := generateTestKeys()
	if err != nil {
		t.Fatalf("error generating test keys: %s", err)
	}
	nonPKCS8Keys, err := generateNonPKCS8FormatKeys()
	if err != nil {
		t.Fatalf("error generating non-PKCS#8 test keys: %s", err)
	}

	tests := map[string]struct {
		policy      Policy
		key         []byte
		shouldError bool
		wantErr     string
	}{
		"import AES key": {
			policy: Policy{
				Name: "test-aes-key",
				Type: KeyType_AES256_GCM96,
			},
			key:         testKeys[KeyType_AES256_GCM96],
			shouldError: false,
		},
		"import RSA key": {
			policy: Policy{
				Name: "test-rsa-key",
				Type: KeyType_RSA2048,
			},
			key:         testKeys[KeyType_RSA2048],
			shouldError: false,
		},
		"import ECDSA key": {
			policy: Policy{
				Name: "test-ecdsa-key",
				Type: KeyType_ECDSA_P256,
			},
			key:         testKeys[KeyType_ECDSA_P256],
			shouldError: false,
		},
		"import ED25519 key": {
			policy: Policy{
				Name: "test-ed25519-key",
				Type: KeyType_ED25519,
			},
			key:         testKeys[KeyType_ED25519],
			shouldError: false,
		},
		"import incorrect key type": {
			policy: Policy{
				Name: "test-ed25519-key",
				Type: KeyType_ED25519,
			},
			key:         testKeys[KeyType_AES256_GCM96],
			shouldError: true,
		},
		"import incorrect rsa key format": {
			policy: Policy{
				Name: "test-non-pkcs8-rsa-key",
				Type: KeyType_RSA2048,
			},
			key:         nonPKCS8Keys[KeyType_RSA2048],
			shouldError: true,
			wantErr:     "error parsing asymmetric key: private key must be encoded as PKCS#8; detected key format: RSA PRIVATE KEY (PKCS#1)",
		},
		"import incorrect ecdsa key format": {
			policy: Policy{
				Name: "test-non-pkcs8-ecdsa-key",
				Type: KeyType_ECDSA_P256,
			},
			key:         nonPKCS8Keys[KeyType_ECDSA_P256],
			shouldError: true,
			wantErr:     "error parsing asymmetric key: private key must be encoded as PKCS#8; detected key format: EC PRIVATE KEY (SEC1)",
		},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			err := test.policy.Import(ctx, storage, test.key, rand.Reader)
			if (err != nil) != test.shouldError {
				t.Fatalf("error importing key: %s", err)
			}

			if test.wantErr != "" && (err == nil || !strings.Contains(err.Error(), test.wantErr)) {
				t.Fatalf("expected error containing: %q, got %q", test.wantErr, err)
			}
		})
	}
}

func generateNonPKCS8FormatKeys() (map[KeyType][]byte, error) {
	keyMap := make(map[KeyType][]byte)

	rsaKey, err := cryptoutil.GenerateRSAKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	keyMap[KeyType_RSA2048] = x509.MarshalPKCS1PrivateKey(rsaKey)

	ecdsaKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}

	sec1DER, err := x509.MarshalECPrivateKey(ecdsaKey)
	if err != nil {
		return nil, err
	}
	keyMap[KeyType_ECDSA_P256] = sec1DER

	return keyMap, nil
}

func generateTestKeys() (map[KeyType][]byte, error) {
	keyMap := make(map[KeyType][]byte)

	rsaKey, err := cryptoutil.GenerateRSAKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	rsaKeyBytes, err := x509.MarshalPKCS8PrivateKey(rsaKey)
	if err != nil {
		return nil, err
	}
	keyMap[KeyType_RSA2048] = rsaKeyBytes

	rsaKey, err = cryptoutil.GenerateRSAKey(rand.Reader, 3072)
	if err != nil {
		return nil, err
	}
	rsaKeyBytes, err = x509.MarshalPKCS8PrivateKey(rsaKey)
	if err != nil {
		return nil, err
	}
	keyMap[KeyType_RSA3072] = rsaKeyBytes

	rsaKey, err = cryptoutil.GenerateRSAKey(rand.Reader, 4096)
	if err != nil {
		return nil, err
	}
	rsaKeyBytes, err = x509.MarshalPKCS8PrivateKey(rsaKey)
	if err != nil {
		return nil, err
	}
	keyMap[KeyType_RSA4096] = rsaKeyBytes

	ecdsaKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	ecdsaKeyBytes, err := x509.MarshalPKCS8PrivateKey(ecdsaKey)
	if err != nil {
		return nil, err
	}
	keyMap[KeyType_ECDSA_P256] = ecdsaKeyBytes

	_, ed25519Key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	ed25519KeyBytes, err := x509.MarshalPKCS8PrivateKey(ed25519Key)
	if err != nil {
		return nil, err
	}
	keyMap[KeyType_ED25519] = ed25519KeyBytes

	aesKey := make([]byte, 32)
	_, err = rand.Read(aesKey)
	if err != nil {
		return nil, err
	}
	keyMap[KeyType_AES256_GCM96] = aesKey

	return keyMap, nil
}

func BenchmarkSymmetric(b *testing.B) {
	ctx := context.Background()
	lm, _ := NewLockManager(true, 0)
	storage := &logical.InmemStorage{}
	p, _, _ := lm.GetPolicy(ctx, PolicyRequest{
		Upsert:  true,
		Storage: storage,
		KeyType: KeyType_AES256_GCM96,
		Name:    "test",
	}, rand.Reader)
	defer p.Unlock()
	key, _ := p.GetKey(nil, 1, 32)
	pt := make([]byte, 10)
	ad := make([]byte, 10)
	for i := 0; i < b.N; i++ {
		ct, _ := p.SymmetricEncryptRaw(1, key, pt,
			SymmetricOpts{
				AdditionalData: ad,
			})
		pt2, _ := p.SymmetricDecryptRaw(key, ct, SymmetricOpts{
			AdditionalData: ad,
			Algorithm:      p.KeyVersionType(1),
		})
		if !bytes.Equal(pt, pt2) {
			b.Fail()
		}
	}
}

func saltOptions(options SigningOptions, saltLength int) SigningOptions {
	return SigningOptions{
		HashAlgorithm: options.HashAlgorithm,
		Marshaling:    options.Marshaling,
		SaltLength:    saltLength,
		SigAlgorithm:  options.SigAlgorithm,
	}
}

func manualVerify(depth int, t *testing.T, p *Policy, input []byte, sig *SigningResult, options SigningOptions) {
	tabs := strings.Repeat("\t", depth)
	t.Log(tabs, "Manually verifying signature with options:", options)

	tabs = strings.Repeat("\t", depth+1)
	verified, err := p.VerifySignatureWithOptions(nil, input, sig.Signature, &options)
	if err != nil {
		t.Fatal(tabs, "❌ Failed to manually verify signature:", err)
	}
	if !verified {
		t.Fatal(tabs, "❌ Failed to manually verify signature")
	}
}

func autoVerify(depth int, t *testing.T, p *Policy, input []byte, sig *SigningResult, options SigningOptions) {
	tabs := strings.Repeat("\t", depth)
	t.Log(tabs, "Automatically verifying signature with options:", options)

	tabs = strings.Repeat("\t", depth+1)
	verified, err := p.VerifySignature(nil, input, options.HashAlgorithm, options.SigAlgorithm, options.Marshaling, sig.Signature)
	if err != nil {
		t.Fatal(tabs, "❌ Failed to automatically verify signature:", err)
	}
	if !verified {
		t.Fatal(tabs, "❌ Failed to automatically verify signature")
	}
}

func autoVerifyDecrypt(depth int, t *testing.T, p *Policy, input []byte, ct string, factories ...any) {
	tabs := strings.Repeat("\t", depth)
	t.Log(tabs, "Automatically decrypting with options:", factories)

	tabs = strings.Repeat("\t", depth+1)
	ptb64, err := p.DecryptWithOptions(EncryptionOptions{}, ct, factories...)
	if err != nil {
		t.Fatal(tabs, "❌ Failed to automatically verify signature:", err)
	}

	pt, err := base64.StdEncoding.DecodeString(ptb64)
	if err != nil {
		t.Fatal(tabs, "❌ Failed decoding plaintext:", err)
	}
	if !bytes.Equal(input, pt) {
		t.Fatal(tabs, "❌ Failed to automatically decrypt")
	}
}

func Test_RSA_PSS(t *testing.T) {
	t.Log("Testing RSA PSS")
	mathrand.Seed(time.Now().UnixNano())

	var userError errutil.UserError
	ctx := context.Background()
	storage := &logical.InmemStorage{}
	// https://crypto.stackexchange.com/a/1222
	input := []byte("the ancients say the longer the salt, the more provable the security")
	sigAlgorithm := "pss"

	tabs := make(map[int]string)
	for i := 1; i <= 6; i++ {
		tabs[i] = strings.Repeat("\t", i)
	}

	test_RSA_PSS := func(t *testing.T, p *Policy, rsaKey *rsa.PrivateKey, hashType HashType,
		marshalingType MarshalingType,
	) {
		unsaltedOptions := SigningOptions{
			HashAlgorithm: hashType,
			Marshaling:    marshalingType,
			SigAlgorithm:  sigAlgorithm,
		}
		cryptoHash := CryptoHashMap[hashType]
		minSaltLength := p.minRSAPSSSaltLength()
		maxSaltLength := p.maxRSAPSSSaltLength(rsaKey.N.BitLen(), cryptoHash)
		hash := cryptoHash.New()
		hash.Write(input)
		input = hash.Sum(nil)

		// 1. Make an "automatic" signature with the given key size and hash algorithm,
		// but an automatically chosen salt length.
		t.Log(tabs[3], "Make an automatic signature")
		sig, err := p.Sign(0, nil, input, hashType, sigAlgorithm, marshalingType)
		if err != nil {
			// A bit of a hack but FIPS go does not support some hash types
			if isUnsupportedGoHashType(hashType, err) {
				t.Skip(tabs[4], "skipping test as FIPS Go does not support hash type")
				return
			}
			t.Fatal(tabs[4], "❌ Failed to automatically sign:", err)
		}

		// 1.1 Verify this automatic signature using the *inferred* salt length.
		autoVerify(4, t, p, input, sig, unsaltedOptions)

		// 1.2. Verify this automatic signature using the *correct, given* salt length.
		manualVerify(4, t, p, input, sig, saltOptions(unsaltedOptions, maxSaltLength))

		// 1.3. Try to verify this automatic signature using *incorrect, given* salt lengths.
		t.Log(tabs[4], "Test incorrect salt lengths")
		incorrectSaltLengths := []int{minSaltLength, maxSaltLength - 1}
		for _, saltLength := range incorrectSaltLengths {
			t.Log(tabs[5], "Salt length:", saltLength)
			saltedOptions := saltOptions(unsaltedOptions, saltLength)

			verified, _ := p.VerifySignatureWithOptions(nil, input, sig.Signature, &saltedOptions)
			if verified {
				t.Fatal(tabs[6], "❌ Failed to invalidate", verified, "signature using incorrect salt length:", err)
			}
		}

		// 2. Rule out boundary, invalid salt lengths.
		t.Log(tabs[3], "Test invalid salt lengths")
		invalidSaltLengths := []int{minSaltLength - 1, maxSaltLength + 1}
		for _, saltLength := range invalidSaltLengths {
			t.Log(tabs[4], "Salt length:", saltLength)
			saltedOptions := saltOptions(unsaltedOptions, saltLength)

			// 2.1. Fail to sign.
			t.Log(tabs[5], "Try to make a manual signature")
			_, err := p.SignWithOptions(0, nil, input, &saltedOptions)
			if !errors.As(err, &userError) {
				t.Fatal(tabs[6], "❌ Failed to reject invalid salt length:", err)
			}

			// 2.2. Fail to verify.
			t.Log(tabs[5], "Try to verify an automatic signature using an invalid salt length")
			_, err = p.VerifySignatureWithOptions(nil, input, sig.Signature, &saltedOptions)
			if !errors.As(err, &userError) {
				t.Fatal(tabs[6], "❌ Failed to reject invalid salt length:", err)
			}
		}

		// 3. For three possible valid salt lengths...
		t.Log(tabs[3], "Test three possible valid salt lengths")
		midSaltLength := mathrand.Intn(maxSaltLength-1) + 1 // [1, maxSaltLength)
		validSaltLengths := []int{minSaltLength, midSaltLength, maxSaltLength}
		for _, saltLength := range validSaltLengths {
			t.Log(tabs[4], "Salt length:", saltLength)
			saltedOptions := saltOptions(unsaltedOptions, saltLength)

			// 3.1. Make a "manual" signature with the given key size, hash algorithm, and salt length.
			t.Log(tabs[5], "Make a manual signature")
			sig, err := p.SignWithOptions(0, nil, input, &saltedOptions)
			if err != nil {
				t.Fatal(tabs[6], "❌ Failed to manually sign:", err)
			}

			// 3.2. Verify this manual signature using the *correct, given* salt length.
			manualVerify(6, t, p, input, sig, saltedOptions)

			// 3.3. Verify this manual signature using the *inferred* salt length.
			autoVerify(6, t, p, input, sig, unsaltedOptions)
		}
	}

	rsaKeyTypes := []KeyType{KeyType_RSA2048, KeyType_RSA3072, KeyType_RSA4096}
	testKeys, err := generateTestKeys()
	if err != nil {
		t.Fatalf("error generating test keys: %s", err)
	}

	// 1. For each standard RSA key size 2048, 3072, and 4096...
	for _, rsaKeyType := range rsaKeyTypes {
		t.Log("Key size: ", rsaKeyType)
		p := &Policy{
			Name: fmt.Sprint(rsaKeyType), // NOTE: crucial to create a new key per key size
			Type: rsaKeyType,
		}

		rsaKeyBytes := testKeys[rsaKeyType]
		err := p.Import(ctx, storage, rsaKeyBytes, rand.Reader)
		if err != nil {
			t.Fatal(tabs[1], "❌ Failed to import key:", err)
		}
		rsaKeyAny, err := x509.ParsePKCS8PrivateKey(rsaKeyBytes)
		if err != nil {
			t.Fatalf("error parsing test keys: %s", err)
		}
		rsaKey := rsaKeyAny.(*rsa.PrivateKey)

		// 2. For each hash algorithm...
		for hashAlgorithm, hashType := range HashTypeMap {
			t.Log(tabs[1], "Hash algorithm:", hashAlgorithm)
			if hashAlgorithm == "none" {
				continue
			}

			// 3. For each marshaling type...
			for marshalingName, marshalingType := range MarshalingTypeMap {
				t.Log(tabs[2], "Marshaling type:", marshalingName)
				testName := fmt.Sprintf("%s-%s-%s", rsaKeyType, hashAlgorithm, marshalingName)
				t.Run(testName, func(t *testing.T) { test_RSA_PSS(t, p, rsaKey, hashType, marshalingType) })
			}
		}
	}
}

func Test_RSA_PKCS1Encryption(t *testing.T) {
	t.Log("Testing RSA PKCS#1v1.5 padded encryption")

	ctx := context.Background()
	storage := &logical.InmemStorage{}
	// https://crypto.stackexchange.com/a/1222
	pt := []byte("Sphinx of black quartz, judge my vow")
	input := base64.StdEncoding.EncodeToString(pt)

	tabs := make(map[int]string)
	for i := 1; i <= 6; i++ {
		tabs[i] = strings.Repeat("\t", i)
	}

	test_RSA_PKCS1 := func(t *testing.T, p *Policy, rsaKey *rsa.PrivateKey, padding PaddingScheme) {
		// 1. Make a signature with the given key size and hash algorithm.
		t.Log(tabs[3], "Make an automatic signature")
		ct, err := p.EncryptWithOptions(EncryptionOptions{}, string(input), padding)
		if err != nil {
			t.Fatal(tabs[4], "❌ Failed to automatically encrypt:", err)
		}

		// 1.1 Verify this signature using the *inferred* salt length.
		autoVerifyDecrypt(4, t, p, pt, ct, padding)
	}

	rsaKeyTypes := []KeyType{KeyType_RSA2048, KeyType_RSA3072, KeyType_RSA4096}
	testKeys, err := generateTestKeys()
	if err != nil {
		t.Fatalf("error generating test keys: %s", err)
	}

	// 1. For each standard RSA key size 2048, 3072, and 4096...
	for _, rsaKeyType := range rsaKeyTypes {
		t.Log("Key size: ", rsaKeyType)
		p := &Policy{
			Name: fmt.Sprint(rsaKeyType), // NOTE: crucial to create a new key per key size
			Type: rsaKeyType,
		}

		rsaKeyBytes := testKeys[rsaKeyType]
		err := p.Import(ctx, storage, rsaKeyBytes, rand.Reader)
		if err != nil {
			t.Fatal(tabs[1], "❌ Failed to import key:", err)
		}
		rsaKeyAny, err := x509.ParsePKCS8PrivateKey(rsaKeyBytes)
		if err != nil {
			t.Fatalf("error parsing test keys: %s", err)
		}
		rsaKey := rsaKeyAny.(*rsa.PrivateKey)
		for _, padding := range []PaddingScheme{PaddingScheme_OAEP, PaddingScheme_PKCS1v15, ""} {
			t.Run(fmt.Sprintf("%s/%s", rsaKeyType.String(), padding), func(t *testing.T) { test_RSA_PKCS1(t, p, rsaKey, padding) })
		}
	}
}

func Test_RSA_PKCS1Signing(t *testing.T) {
	t.Log("Testing RSA PKCS#1v1.5 signatures")

	ctx := context.Background()
	storage := &logical.InmemStorage{}
	// https://crypto.stackexchange.com/a/1222
	input := []byte("Sphinx of black quartz, judge my vow")
	sigAlgorithm := "pkcs1v15"

	tabs := make(map[int]string)
	for i := 1; i <= 6; i++ {
		tabs[i] = strings.Repeat("\t", i)
	}

	test_RSA_PKCS1 := func(t *testing.T, p *Policy, rsaKey *rsa.PrivateKey, hashType HashType,
		marshalingType MarshalingType,
	) {
		unsaltedOptions := SigningOptions{
			HashAlgorithm: hashType,
			Marshaling:    marshalingType,
			SigAlgorithm:  sigAlgorithm,
		}
		cryptoHash := CryptoHashMap[hashType]

		// PKCS#1v1.5 NoOID uses a direct input and assumes it is pre-hashed.
		if hashType != 0 {
			hash := cryptoHash.New()
			hash.Write(input)
			input = hash.Sum(nil)
		}

		// 1. Make a signature with the given key size and hash algorithm.
		t.Log(tabs[3], "Make an automatic signature")
		sig, err := p.Sign(0, nil, input, hashType, sigAlgorithm, marshalingType)
		if err != nil {
			// A bit of a hack but FIPS go does not support some hash types
			if isUnsupportedGoHashType(hashType, err) {
				t.Skip(tabs[4], "skipping test as FIPS Go does not support hash type")
				return
			}
			t.Fatal(tabs[4], "❌ Failed to automatically sign:", err)
		}

		// 1.1 Verify this signature using the *inferred* salt length.
		autoVerify(4, t, p, input, sig, unsaltedOptions)
	}

	rsaKeyTypes := []KeyType{KeyType_RSA2048, KeyType_RSA3072, KeyType_RSA4096}
	testKeys, err := generateTestKeys()
	if err != nil {
		t.Fatalf("error generating test keys: %s", err)
	}

	// 1. For each standard RSA key size 2048, 3072, and 4096...
	for _, rsaKeyType := range rsaKeyTypes {
		t.Log("Key size: ", rsaKeyType)
		p := &Policy{
			Name: fmt.Sprint(rsaKeyType), // NOTE: crucial to create a new key per key size
			Type: rsaKeyType,
		}

		rsaKeyBytes := testKeys[rsaKeyType]
		err := p.Import(ctx, storage, rsaKeyBytes, rand.Reader)
		if err != nil {
			t.Fatal(tabs[1], "❌ Failed to import key:", err)
		}
		rsaKeyAny, err := x509.ParsePKCS8PrivateKey(rsaKeyBytes)
		if err != nil {
			t.Fatalf("error parsing test keys: %s", err)
		}
		rsaKey := rsaKeyAny.(*rsa.PrivateKey)

		// 2. For each hash algorithm...
		for hashAlgorithm, hashType := range HashTypeMap {
			t.Log(tabs[1], "Hash algorithm:", hashAlgorithm)

			// 3. For each marshaling type...
			for marshalingName, marshalingType := range MarshalingTypeMap {
				t.Log(tabs[2], "Marshaling type:", marshalingName)
				testName := fmt.Sprintf("%s-%s-%s", rsaKeyType, hashAlgorithm, marshalingName)
				t.Run(testName, func(t *testing.T) { test_RSA_PKCS1(t, p, rsaKey, hashType, marshalingType) })
			}
		}
	}
}

// Normal Go builds support all the hash functions for RSA_PSS signatures but the
// FIPS Go build does not support at this time the SHA3 hashes as FIPS 140_2 does
// not accept them.
func isUnsupportedGoHashType(hashType HashType, err error) bool {
	// Skip over SHA3 hash tests when running with boringcrypto as it still doesn't support it or hasn't been
	// validated yet. Wasn't available in FIPS-140-2, but should be in FIPS-140-3 eventually?
	if strings.Contains(runtime.Version(), "X:boringcrypto") {
		switch hashType {
		case HashTypeSHA3224, HashTypeSHA3256, HashTypeSHA3384, HashTypeSHA3512:
			return strings.Contains(err.Error(), "unsupported hash function")
		}
	}

	return false
}

// TestPolicy_KeyEntryAlgorithm verifies that KeyVersionType falls back to the
// policy-level Type when the key entry's Algorithm is nil, and returns the
// entry-level algorithm when it is set to a non-nil pointer.
func TestPolicy_KeyEntryAlgorithm(t *testing.T) {
	t.Parallel()

	policyType := KeyType(KeyType_AES256_GCM96)
	entryType := KeyType(KeyType_ECDSA_P256)

	p := &Policy{
		Type: policyType,
		Keys: keyEntryMap{
			"1": KeyEntry{Algorithm: nil},
			"2": KeyEntry{Algorithm: &entryType},
		},
	}

	require.Equal(t, policyType, p.KeyVersionType(1), "nil Algorithm should fall back to policy Type")
	require.Equal(t, entryType, p.KeyVersionType(2), "non-nil Algorithm should return the entry-level algorithm")
	require.Equal(t, policyType, p.KeyVersionType(99), "missing key version should fall back to policy Type")
}

// TestPolicy_RotateInMemoryWithAlgorithmSetsAlgorithmField verifies that after
// RotateInMemoryWithAlgorithm the newly created key entry has its Algorithm
// pointer set to the requested key type when the key usage is unchanged.
func TestPolicy_RotateInMemoryWithAlgorithmSetsAlgorithmField(t *testing.T) {
	t.Parallel()

	p := &Policy{
		Type: KeyType_AES256_GCM96,
		Keys: keyEntryMap{
			"1": KeyEntry{},
		},
		LatestVersion:        1,
		MinDecryptionVersion: 1,
	}

	rotateType := KeyType(KeyType_AES128_GCM96)
	resp, err := p.RotateInMemoryWithAlgorithm(rand.Reader, rotateType, nil)
	require.NoError(t, err)
	require.Nil(t, resp, "a successful rotation must not return an error response")
	require.Equal(t, 2, p.LatestVersion)

	entry, ok := p.Keys[strconv.Itoa(p.LatestVersion)]
	require.True(t, ok, "new key version should exist after rotation")
	require.NotNil(t, entry.Algorithm, "Algorithm should be non-nil after RotateInMemoryWithAlgorithm")
	require.Equal(t, rotateType, *entry.Algorithm, "Algorithm pointer should point to the requested key type")
	require.Equal(t, rotateType, p.KeyVersionType(p.LatestVersion))
}

// TestPolicy_RotateInMemoryWithAlgorithmRejectsUsageChanges verifies that
// RotateInMemoryWithAlgorithm rejects algorithm changes that alter key usage.
func TestPolicy_RotateInMemoryWithAlgorithmRejectsUsageChanges(t *testing.T) {
	t.Parallel()

	p := &Policy{
		Type: KeyType_AES256_GCM96,
		Keys: keyEntryMap{
			"1": KeyEntry{},
		},
		LatestVersion:        1,
		MinDecryptionVersion: 1,
	}

	resp, err := p.RotateInMemoryWithAlgorithm(rand.Reader, KeyType_ECDSA_P256, nil)
	require.EqualError(t, err, "incompatible algorithm ecdsa-p256 for key type aes256-gcm96")
	require.Nil(t, resp, "a usage-change rejection is not a FIPS error and carries no structured response")
	require.Equal(t, 1, p.LatestVersion)
	_, ok := p.Keys["2"]
	require.False(t, ok, "new key version should not be created after a rejected algorithm change")
}

// policyTestCryptoBarrier is a minimal CryptoBarrier implementation used to
// verify that a mock barrier injected via LockManager.WithCryptoBarrier is
// reachable from the LockManager and that its encrypt/decrypt operations
// delegate correctly, independently of (and without disturbing) the
// transit Policy encrypt/decrypt path exercised elsewhere in this file.
type policyTestCryptoBarrier struct {
	encrypted map[string][]byte
}

func (b *policyTestCryptoBarrier) Encrypt(_ context.Context, key string, plaintext []byte) ([]byte, error) {
	if b.encrypted == nil {
		b.encrypted = make(map[string][]byte)
	}
	ciphertext := append([]byte("barrier:"), plaintext...)
	b.encrypted[key] = ciphertext
	return ciphertext, nil
}

func (b *policyTestCryptoBarrier) Decrypt(_ context.Context, key string, ciphertext []byte) ([]byte, error) {
	stored, ok := b.encrypted[key]
	if !ok || !bytes.Equal(stored, ciphertext) {
		return nil, errors.New("policyTestCryptoBarrier: ciphertext does not match stored value for key")
	}
	return bytes.TrimPrefix(ciphertext, []byte("barrier:")), nil
}

func (b *policyTestCryptoBarrier) RotateKey(_ context.Context) error {
	return nil
}

// TestLockManager_CryptoBarrierInjection_DelegatesEncryptDecrypt verifies
// that a mock CryptoBarrier can be injected into a LockManager via
// WithCryptoBarrier and that Encrypt/Decrypt calls made through the stored
// CryptoBarrier delegate to that mock, while ordinary transit Policy
// encrypt/decrypt operations on the same LockManager remain unaffected.
func TestLockManager_CryptoBarrierInjection_DelegatesEncryptDecrypt(t *testing.T) {
	t.Parallel()

	barrier := &policyTestCryptoBarrier{}
	lm, err := NewLockManager(true, 0, WithCryptoBarrier(barrier))
	require.NoError(t, err)

	ctx := context.Background()

	// The injected CryptoBarrier delegates encrypt/decrypt to the mock.
	cb := lm.GetCryptoBarrier()
	require.NotNil(t, cb)

	ciphertext, err := cb.Encrypt(ctx, "root", []byte("plaintext"))
	require.NoError(t, err)
	require.NotEqual(t, []byte("plaintext"), ciphertext)

	plaintext, err := cb.Decrypt(ctx, "root", ciphertext)
	require.NoError(t, err)
	require.Equal(t, []byte("plaintext"), plaintext)

	// Ordinary Policy-level encrypt/decrypt through the same LockManager
	// (unrelated to the injected barrier) continues to work identically.
	storage := &logical.InmemStorage{}
	p, _, err := lm.GetPolicy(ctx, PolicyRequest{
		Name:    "transit-key",
		KeyType: KeyType_AES256_GCM96,
		Storage: storage,
		Upsert:  true,
	}, rand.Reader)
	require.NoError(t, err)
	defer p.Unlock()

	transitCiphertext, err := p.Encrypt(0, nil, nil, base64.StdEncoding.EncodeToString([]byte("transit-plaintext")))
	require.NoError(t, err)

	transitPlaintext, err := p.Decrypt(nil, nil, transitCiphertext)
	require.NoError(t, err)
	decoded, err := base64.StdEncoding.DecodeString(transitPlaintext)
	require.NoError(t, err)
	require.Equal(t, []byte("transit-plaintext"), decoded)
}

// --- FIPS enforcement (WO-027) ---
//
// isFIPSMode() resolves to false here (fips.go) or true in a binary built
// with -tags fips (fips_enabled.go). Splitting the assertions along that
// same build tag -- rather than mocking IsFIPSApproved()/isFIPSMode() at
// runtime -- is deliberate: it proves the gate in RotateInMemoryWithAlgorithm
// behaves correctly for an actual FIPS build, not just for a test double.
// This file (no build tag, so it always compiles) covers IsFIPSApproved()
// itself, the shared pre-existing-key fixtures used by both this file and
// policy_fips_test.go, and the "FIPS mode off" half of the matrix. The
// "FIPS mode on" half lives in policy_fips_test.go (//go:build fips).

// TestKeyType_IsFIPSApproved verifies IsFIPSApproved() returns false only
// for the two non-Approved algorithms (ChaCha20-Poly1305, Ed25519) and true
// for every other key type, including enterprise-only and managed types.
func TestKeyType_IsFIPSApproved(t *testing.T) {
	t.Parallel()

	nonApproved := map[KeyType]bool{
		KeyType_ChaCha20_Poly1305: true,
		KeyType_ED25519:           true,
	}

	for _, kt := range allTestKeyTypes {
		want := !nonApproved[kt]
		require.Equal(t, want, kt.IsFIPSApproved(), "unexpected IsFIPSApproved() for %s", kt)
	}
}

// newExistingChaCha20Fixture returns a Policy with one already-generated
// ChaCha20-Poly1305 key version, simulating a key created before FIPS mode
// was enabled (or on a non-FIPS build). It deliberately does not go through
// Rotate/RotateInMemoryWithAlgorithm, so the fixture itself is unaffected by
// the FIPS-mode gate under test; its purpose is to exercise the
// backward-compatible read path for a non-Approved key type that must keep
// working even when isFIPSMode() returns true (AC9).
func newExistingChaCha20Fixture(t *testing.T) *Policy {
	t.Helper()

	key := make([]byte, 32)
	_, err := rand.Read(key)
	require.NoError(t, err)
	hmacKey := make([]byte, 32)
	_, err = rand.Read(hmacKey)
	require.NoError(t, err)

	algo := KeyType(KeyType_ChaCha20_Poly1305)
	return &Policy{
		Name:                 "existing-chacha20-key",
		Type:                 KeyType_ChaCha20_Poly1305,
		LatestVersion:        1,
		MinDecryptionVersion: 1,
		Keys: keyEntryMap{
			"1": KeyEntry{
				Key:          key,
				HMACKey:      hmacKey,
				Algorithm:    &algo,
				CreationTime: time.Now(),
			},
		},
	}
}

// preGeneratedChaCha20Ciphertext encrypts plaintext under p's latest
// ChaCha20-Poly1305 key version using the same low-level primitives
// EncryptWithOptions uses internally (getSymmetricKeys + SymmetricEncryptRaw
// + getVersionPrefix), but without going through EncryptWithOptions/Encrypt
// itself. It stands in for a ciphertext blob that was already produced and
// stored before WO-042 gated new ChaCha20-Poly1305 encryption under FIPS
// mode (AC8's "pre-generated ChaCha20-Poly1305 ciphertext blobs"): building
// it this way keeps the fixture valid under a FIPS build, where calling
// p.Encrypt directly would now be rejected by that gate.
func preGeneratedChaCha20Ciphertext(t *testing.T, p *Policy, plaintext []byte) string {
	t.Helper()

	encKey, hmacKey, err := p.getSymmetricKeys(EncryptionOptions{KeyVersion: p.LatestVersion})
	require.NoError(t, err)

	raw, err := p.SymmetricEncryptRaw(p.LatestVersion, encKey, plaintext, SymmetricOpts{HMACKey: hmacKey})
	require.NoError(t, err)

	return p.getVersionPrefix(p.LatestVersion) + base64.StdEncoding.EncodeToString(raw)
}

// newExistingEd25519Fixture returns a Policy with one already-generated
// Ed25519 key version, simulating a key created before FIPS mode was
// enabled. See newExistingChaCha20Fixture for why it bypasses Rotate (AC9).
func newExistingEd25519Fixture(t *testing.T) *Policy {
	t.Helper()

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	hmacKey := make([]byte, 32)
	_, err = rand.Read(hmacKey)
	require.NoError(t, err)

	algo := KeyType(KeyType_ED25519)
	return &Policy{
		Name:                 "existing-ed25519-key",
		Type:                 KeyType_ED25519,
		LatestVersion:        1,
		MinDecryptionVersion: 1,
		Keys: keyEntryMap{
			"1": KeyEntry{
				Key:                priv,
				FormattedPublicKey: base64.StdEncoding.EncodeToString(pub),
				HMACKey:            hmacKey,
				Algorithm:          &algo,
				CreationTime:       time.Now(),
			},
		},
	}
}

// TestPolicy_NonFIPSMode_NonApprovedKeyTypesFullyFunctional proves that on a
// non-FIPS build (isFIPSMode() == false, the default for every existing
// deployment), ChaCha20-Poly1305 and Ed25519 continue to support the full
// key lifecycle -- creation, rotation, encrypt/decrypt, sign/verify --
// exactly as before this story (AC7).
func TestPolicy_NonFIPSMode_NonApprovedKeyTypesFullyFunctional(t *testing.T) {
	if isFIPSMode() {
		t.Skip("this test asserts default (non-FIPS build) behavior; see policy_fips_test.go for the FIPS-mode-on assertions")
	}
	t.Parallel()

	ctx := context.Background()

	t.Run("chacha20-poly1305", func(t *testing.T) {
		lm, err := NewLockManager(true, 0)
		require.NoError(t, err)
		storage := &logical.InmemStorage{}

		p, _, err := lm.GetPolicy(ctx, PolicyRequest{
			Name:    "chacha20-lifecycle",
			KeyType: KeyType_ChaCha20_Poly1305,
			Storage: storage,
			Upsert:  true,
		}, rand.Reader)
		require.NoError(t, err, "new chacha20-poly1305 key creation must succeed outside FIPS mode")
		defer p.Unlock()
		require.Equal(t, 1, p.LatestVersion)

		err = p.Rotate(ctx, storage, rand.Reader)
		require.NoError(t, err, "rotating a chacha20-poly1305 key must succeed outside FIPS mode")
		require.Equal(t, 2, p.LatestVersion)

		ct, err := p.Encrypt(0, nil, nil, base64.StdEncoding.EncodeToString([]byte("hello")))
		require.NoError(t, err)
		pt, err := p.Decrypt(nil, nil, ct)
		require.NoError(t, err)
		decoded, err := base64.StdEncoding.DecodeString(pt)
		require.NoError(t, err)
		require.Equal(t, []byte("hello"), decoded)
	})

	t.Run("ed25519", func(t *testing.T) {
		lm, err := NewLockManager(true, 0)
		require.NoError(t, err)
		storage := &logical.InmemStorage{}

		p, _, err := lm.GetPolicy(ctx, PolicyRequest{
			Name:    "ed25519-lifecycle",
			KeyType: KeyType_ED25519,
			Storage: storage,
			Upsert:  true,
		}, rand.Reader)
		require.NoError(t, err, "new ed25519 key creation must succeed outside FIPS mode")
		defer p.Unlock()
		require.Equal(t, 1, p.LatestVersion)

		err = p.Rotate(ctx, storage, rand.Reader)
		require.NoError(t, err, "rotating an ed25519 key must succeed outside FIPS mode")
		require.Equal(t, 2, p.LatestVersion)

		sig, err := p.Sign(0, nil, []byte("hello"), HashTypeNone, "", MarshalingTypeASN1)
		require.NoError(t, err)
		verified, err := p.VerifySignature(nil, []byte("hello"), HashTypeNone, "", MarshalingTypeASN1, sig.Signature)
		require.NoError(t, err)
		require.True(t, verified)
	})
}

// --- Performance regression benchmarks (WO-042, AC7) ---
//
// These compare AES-256-GCM (the FIPS-Approved replacement) against
// ChaCha20-Poly1305 (the algorithm being migrated away from) for encrypt
// and decrypt, at the 1KB/64KB/1MB payload sizes AC7 calls out. Run with:
//
//	go test ./sdk/helper/keysutil/ -run '^$' -bench BenchmarkPolicy -benchtime=2s
//
// and compare ns/op (or the reported MB/s from -benchmem/SetBytes) between
// the AES256GCM96 and ChaCha20Poly1305 variants at each payload size: AC7
// requires AES-256-GCM to be within 10% of the ChaCha20-Poly1305 baseline.
//
// Policies are built directly (like newExistingChaCha20Fixture) rather
// than via LockManager.GetPolicy, so that benchmarking a ChaCha20-Poly1305
// policy does not itself trip the WO-027 creation gate under a FIPS build.
// Decrypt benchmarks seed their ciphertext via the same raw primitive
// EncryptWithOptions uses internally (SymmetricEncryptRaw), not via
// p.Encrypt, so they measure decrypt throughput independent of -- and
// without tripping -- the encrypt-side FIPS gate added by this story.

func benchmarkPolicyFor(b *testing.B, keyType KeyType) *Policy {
	b.Helper()

	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		b.Fatal(err)
	}
	hmacKey := make([]byte, 32)
	if _, err := rand.Read(hmacKey); err != nil {
		b.Fatal(err)
	}

	algo := keyType
	return &Policy{
		Name:                 "bench-" + keyType.String(),
		Type:                 keyType,
		LatestVersion:        1,
		MinDecryptionVersion: 1,
		Keys: keyEntryMap{
			"1": KeyEntry{
				Key:          key,
				HMACKey:      hmacKey,
				Algorithm:    &algo,
				CreationTime: time.Now(),
			},
		},
	}
}

func rawCiphertextForBenchmark(b *testing.B, p *Policy, plaintext []byte) string {
	b.Helper()

	encKey, hmacKey, err := p.getSymmetricKeys(EncryptionOptions{KeyVersion: p.LatestVersion})
	if err != nil {
		b.Fatal(err)
	}
	raw, err := p.SymmetricEncryptRaw(p.LatestVersion, encKey, plaintext, SymmetricOpts{HMACKey: hmacKey})
	if err != nil {
		b.Fatal(err)
	}
	return p.getVersionPrefix(p.LatestVersion) + base64.StdEncoding.EncodeToString(raw)
}

func benchmarkPolicyEncrypt(b *testing.B, keyType KeyType, payloadSize int) {
	if isFIPSMode() && !keyType.IsFIPSApproved() {
		b.Skipf("%s encryption is rejected under FIPS mode (WO-042); no throughput to measure", keyType)
	}

	p := benchmarkPolicyFor(b, keyType)

	plaintext := make([]byte, payloadSize)
	if _, err := rand.Read(plaintext); err != nil {
		b.Fatal(err)
	}
	value := base64.StdEncoding.EncodeToString(plaintext)

	b.SetBytes(int64(payloadSize))
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := p.Encrypt(0, nil, nil, value); err != nil {
			b.Fatal(err)
		}
	}
}

func benchmarkPolicyDecrypt(b *testing.B, keyType KeyType, payloadSize int) {
	p := benchmarkPolicyFor(b, keyType)

	plaintext := make([]byte, payloadSize)
	if _, err := rand.Read(plaintext); err != nil {
		b.Fatal(err)
	}
	ciphertext := rawCiphertextForBenchmark(b, p, plaintext)

	b.SetBytes(int64(payloadSize))
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := p.Decrypt(nil, nil, ciphertext); err != nil {
			b.Fatal(err)
		}
	}
}

const (
	benchPayload1KB  = 1024
	benchPayload64KB = 64 * 1024
	benchPayload1MB  = 1024 * 1024
)

func BenchmarkPolicy_Encrypt_AES256GCM96_1KB(b *testing.B) {
	benchmarkPolicyEncrypt(b, KeyType_AES256_GCM96, benchPayload1KB)
}

func BenchmarkPolicy_Encrypt_AES256GCM96_64KB(b *testing.B) {
	benchmarkPolicyEncrypt(b, KeyType_AES256_GCM96, benchPayload64KB)
}

func BenchmarkPolicy_Encrypt_AES256GCM96_1MB(b *testing.B) {
	benchmarkPolicyEncrypt(b, KeyType_AES256_GCM96, benchPayload1MB)
}

func BenchmarkPolicy_Encrypt_ChaCha20Poly1305_1KB(b *testing.B) {
	benchmarkPolicyEncrypt(b, KeyType_ChaCha20_Poly1305, benchPayload1KB)
}

func BenchmarkPolicy_Encrypt_ChaCha20Poly1305_64KB(b *testing.B) {
	benchmarkPolicyEncrypt(b, KeyType_ChaCha20_Poly1305, benchPayload64KB)
}

func BenchmarkPolicy_Encrypt_ChaCha20Poly1305_1MB(b *testing.B) {
	benchmarkPolicyEncrypt(b, KeyType_ChaCha20_Poly1305, benchPayload1MB)
}

func BenchmarkPolicy_Decrypt_AES256GCM96_1KB(b *testing.B) {
	benchmarkPolicyDecrypt(b, KeyType_AES256_GCM96, benchPayload1KB)
}

func BenchmarkPolicy_Decrypt_AES256GCM96_64KB(b *testing.B) {
	benchmarkPolicyDecrypt(b, KeyType_AES256_GCM96, benchPayload64KB)
}

func BenchmarkPolicy_Decrypt_AES256GCM96_1MB(b *testing.B) {
	benchmarkPolicyDecrypt(b, KeyType_AES256_GCM96, benchPayload1MB)
}

func BenchmarkPolicy_Decrypt_ChaCha20Poly1305_1KB(b *testing.B) {
	benchmarkPolicyDecrypt(b, KeyType_ChaCha20_Poly1305, benchPayload1KB)
}

func BenchmarkPolicy_Decrypt_ChaCha20Poly1305_64KB(b *testing.B) {
	benchmarkPolicyDecrypt(b, KeyType_ChaCha20_Poly1305, benchPayload64KB)
}

func BenchmarkPolicy_Decrypt_ChaCha20Poly1305_1MB(b *testing.B) {
	benchmarkPolicyDecrypt(b, KeyType_ChaCha20_Poly1305, benchPayload1MB)
}
