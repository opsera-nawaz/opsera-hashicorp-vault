// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: BUSL-1.1

package transit

import (
	"context"
	cryptoRand "crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"

	uuid "github.com/hashicorp/go-uuid"
	"github.com/hashicorp/vault/helper/constants"
	"github.com/hashicorp/vault/sdk/helper/keysutil"
	"github.com/hashicorp/vault/sdk/logical"
	"github.com/mitchellh/mapstructure"
	"github.com/stretchr/testify/require"
)

func TestTransit_MissingPlaintext(t *testing.T) {
	var resp *logical.Response
	var err error

	b, s := createBackendWithStorage(t)

	// Create the policy
	policyReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "keys/existing_key",
		Storage:   s,
	}
	resp, err = b.HandleRequest(context.Background(), policyReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	encReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "encrypt/existing_key",
		Storage:   s,
		Data:      map[string]interface{}{},
	}
	resp, err = b.HandleRequest(context.Background(), encReq)
	if resp == nil || !resp.IsError() {
		t.Fatalf("expected error due to missing plaintext in request, err:%v resp:%#v", err, resp)
	}
	// We expect 0 successful calls
	require.Equal(t, uint64(0), b.secretEngineCounts.Transit.MonthlyCount.Load())
}

func TestTransit_MissingPlaintextInBatchInput(t *testing.T) {
	var resp *logical.Response
	var err error

	b, s := createBackendWithStorage(t)

	// Create the policy
	policyReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "keys/existing_key",
		Storage:   s,
	}
	resp, err = b.HandleRequest(context.Background(), policyReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	batchInput := []interface{}{
		map[string]interface{}{}, // Note that there is no map entry for plaintext
	}

	batchData := map[string]interface{}{
		"batch_input": batchInput,
	}
	batchReq := &logical.Request{
		Operation: logical.CreateOperation,
		Path:      "encrypt/upserted_key",
		Storage:   s,
		Data:      batchData,
	}
	resp, err = b.HandleRequest(context.Background(), batchReq)
	if err == nil {
		t.Fatalf("expected error due to missing plaintext in request, err:%v resp:%#v", err, resp)
	}
	// We expect 0 successful calls
	require.Equal(t, uint64(0), b.secretEngineCounts.Transit.MonthlyCount.Load())
}

// Case1: Ensure that batch encryption did not affect the normal flow of
// encrypting the plaintext with a pre-existing key.
func TestTransit_BatchEncryptionCase1(t *testing.T) {
	var resp *logical.Response
	var err error

	b, s := createBackendWithStorage(t)

	// Create the policy
	policyReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "keys/existing_key",
		Storage:   s,
	}
	resp, err = b.HandleRequest(context.Background(), policyReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	plaintext := "dGhlIHF1aWNrIGJyb3duIGZveA==" // "the quick brown fox"

	encData := map[string]interface{}{
		"plaintext": plaintext,
	}

	encReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "encrypt/existing_key",
		Storage:   s,
		Data:      encData,
	}
	resp, err = b.HandleRequest(context.Background(), encReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	keyVersion := resp.Data["key_version"].(int)
	if keyVersion != 1 {
		t.Fatalf("unexpected key version; got: %d, expected: %d", keyVersion, 1)
	}

	ciphertext := resp.Data["ciphertext"]

	decData := map[string]interface{}{
		"ciphertext": ciphertext,
	}
	decReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "decrypt/existing_key",
		Storage:   s,
		Data:      decData,
	}
	resp, err = b.HandleRequest(context.Background(), decReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	if resp.Data["plaintext"] != plaintext {
		t.Fatalf("bad: plaintext. Expected: %q, Actual: %q", plaintext, resp.Data["plaintext"])
	}

	// We expect 2 successful requests (1 for encrypt, 1 for decrypt)
	require.Equal(t, uint64(2), b.secretEngineCounts.Transit.MonthlyCount.Load())
}

// Case2: Ensure that batch encryption did not affect the normal flow of
// encrypting the plaintext with the key upserted.
func TestTransit_BatchEncryptionCase2(t *testing.T) {
	var resp *logical.Response
	var err error
	b, s := createBackendWithStorage(t)

	// Upsert the key and encrypt the data
	plaintext := "dGhlIHF1aWNrIGJyb3duIGZveA=="

	encData := map[string]interface{}{
		"plaintext": plaintext,
	}

	encReq := &logical.Request{
		Operation: logical.CreateOperation,
		Path:      "encrypt/upserted_key",
		Storage:   s,
		Data:      encData,
	}
	resp, err = b.HandleRequest(context.Background(), encReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	keyVersion := resp.Data["key_version"].(int)
	if keyVersion != 1 {
		t.Fatalf("unexpected key version; got: %d, expected: %d", keyVersion, 1)
	}

	ciphertext := resp.Data["ciphertext"]
	decData := map[string]interface{}{
		"ciphertext": ciphertext,
	}

	policyReq := &logical.Request{
		Operation: logical.ReadOperation,
		Path:      "keys/upserted_key",
		Storage:   s,
	}

	resp, err = b.HandleRequest(context.Background(), policyReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	decReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "decrypt/upserted_key",
		Storage:   s,
		Data:      decData,
	}
	resp, err = b.HandleRequest(context.Background(), decReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	if resp.Data["plaintext"] != plaintext {
		t.Fatalf("bad: plaintext. Expected: %q, Actual: %q", plaintext, resp.Data["plaintext"])
	}

	// We expect 2 successful requests (1 for encrypt, 1 for decrypt)
	require.Equal(t, uint64(2), b.secretEngineCounts.Transit.MonthlyCount.Load())
}

// Case3: If batch encryption input is not base64 encoded, it should fail.
func TestTransit_BatchEncryptionCase3(t *testing.T) {
	var err error

	b, s := createBackendWithStorage(t)

	batchInput := `[{"plaintext":"dGhlIHF1aWNrIGJyb3duIGZveA=="}]`
	batchData := map[string]interface{}{
		"batch_input": batchInput,
	}

	batchReq := &logical.Request{
		Operation: logical.CreateOperation,
		Path:      "encrypt/upserted_key",
		Storage:   s,
		Data:      batchData,
	}
	_, err = b.HandleRequest(context.Background(), batchReq)
	if err == nil {
		t.Fatal("expected an error")
	}

	// We expect 0 successful requests
	require.Equal(t, uint64(0), b.secretEngineCounts.Transit.MonthlyCount.Load())
}

// Case4: Test batch encryption with an existing key (and test references)
func TestTransit_BatchEncryptionCase4(t *testing.T) {
	var resp *logical.Response
	var err error

	b, s := createBackendWithStorage(t)

	policyReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "keys/existing_key",
		Storage:   s,
	}
	resp, err = b.HandleRequest(context.Background(), policyReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	batchInput := []interface{}{
		map[string]interface{}{"plaintext": "dGhlIHF1aWNrIGJyb3duIGZveA==", "reference": "b"},
		map[string]interface{}{"plaintext": "dGhlIHF1aWNrIGJyb3duIGZveA==", "reference": "a"},
	}

	batchData := map[string]interface{}{
		"batch_input": batchInput,
	}
	batchReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "encrypt/existing_key",
		Storage:   s,
		Data:      batchData,
	}
	resp, err = b.HandleRequest(context.Background(), batchReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	batchResponseItems := resp.Data["batch_results"].([]EncryptBatchResponseItem)

	decReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "decrypt/existing_key",
		Storage:   s,
	}

	plaintext := "dGhlIHF1aWNrIGJyb3duIGZveA=="

	for i, item := range batchResponseItems {
		if item.KeyVersion != 1 {
			t.Fatalf("unexpected key version; got: %d, expected: %d", item.KeyVersion, 1)
		}

		decReq.Data = map[string]interface{}{
			"ciphertext": item.Ciphertext,
		}
		resp, err = b.HandleRequest(context.Background(), decReq)
		if err != nil || (resp != nil && resp.IsError()) {
			t.Fatalf("err:%v resp:%#v", err, resp)
		}

		if resp.Data["plaintext"] != plaintext {
			t.Fatalf("bad: plaintext. Expected: %q, Actual: %q", plaintext, resp.Data["plaintext"])
		}
		inputItem := batchInput[i].(map[string]interface{})
		if item.Reference != inputItem["reference"] {
			t.Fatalf("reference mismatch.  Expected %s, Actual: %s", inputItem["reference"], item.Reference)
		}
	}

	// We expect 4 successful requests (2 batch requests + 2 decrypt requests)
	require.Equal(t, uint64(4), b.secretEngineCounts.Transit.MonthlyCount.Load())
}

// Case5: Test batch encryption with an existing derived key
func TestTransit_BatchEncryptionCase5(t *testing.T) {
	var resp *logical.Response
	var err error

	b, s := createBackendWithStorage(t)

	policyData := map[string]interface{}{
		"derived": true,
	}

	policyReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "keys/existing_key",
		Storage:   s,
		Data:      policyData,
	}

	resp, err = b.HandleRequest(context.Background(), policyReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	batchInput := []interface{}{
		map[string]interface{}{"plaintext": "dGhlIHF1aWNrIGJyb3duIGZveA==", "context": "dmlzaGFsCg=="},
		map[string]interface{}{"plaintext": "dGhlIHF1aWNrIGJyb3duIGZveA==", "context": "dmlzaGFsCg=="},
	}

	batchData := map[string]interface{}{
		"batch_input": batchInput,
	}

	batchReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "encrypt/existing_key",
		Storage:   s,
		Data:      batchData,
	}
	resp, err = b.HandleRequest(context.Background(), batchReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	batchResponseItems := resp.Data["batch_results"].([]EncryptBatchResponseItem)

	decReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "decrypt/existing_key",
		Storage:   s,
	}

	plaintext := "dGhlIHF1aWNrIGJyb3duIGZveA=="

	for _, item := range batchResponseItems {
		if item.KeyVersion != 1 {
			t.Fatalf("unexpected key version; got: %d, expected: %d", item.KeyVersion, 1)
		}

		decReq.Data = map[string]interface{}{
			"ciphertext": item.Ciphertext,
			"context":    "dmlzaGFsCg==",
		}
		resp, err = b.HandleRequest(context.Background(), decReq)
		if err != nil || (resp != nil && resp.IsError()) {
			t.Fatalf("err:%v resp:%#v", err, resp)
		}

		if resp.Data["plaintext"] != plaintext {
			t.Fatalf("bad: plaintext. Expected: %q, Actual: %q", plaintext, resp.Data["plaintext"])
		}
	}
	// We expect 4 successful transit requests (2 for batch encryption, 2 for batch decryption)
	require.Equal(t, uint64(4), b.secretEngineCounts.Transit.MonthlyCount.Load())
}

// Case6: Test batch encryption with an upserted non-derived key
func TestTransit_BatchEncryptionCase6(t *testing.T) {
	var resp *logical.Response
	var err error

	b, s := createBackendWithStorage(t)

	batchInput := []interface{}{
		map[string]interface{}{"plaintext": "dGhlIHF1aWNrIGJyb3duIGZveA=="},
		map[string]interface{}{"plaintext": "dGhlIHF1aWNrIGJyb3duIGZveA=="},
	}

	batchData := map[string]interface{}{
		"batch_input": batchInput,
	}
	batchReq := &logical.Request{
		Operation: logical.CreateOperation,
		Path:      "encrypt/upserted_key",
		Storage:   s,
		Data:      batchData,
	}
	resp, err = b.HandleRequest(context.Background(), batchReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	batchResponseItems := resp.Data["batch_results"].([]EncryptBatchResponseItem)

	decReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "decrypt/upserted_key",
		Storage:   s,
	}

	plaintext := "dGhlIHF1aWNrIGJyb3duIGZveA=="

	for _, responseItem := range batchResponseItems {
		var item EncryptBatchResponseItem
		if err := mapstructure.Decode(responseItem, &item); err != nil {
			t.Fatal(err)
		}

		if item.KeyVersion != 1 {
			t.Fatalf("unexpected key version; got: %d, expected: %d", item.KeyVersion, 1)
		}

		decReq.Data = map[string]interface{}{
			"ciphertext": item.Ciphertext,
		}
		resp, err = b.HandleRequest(context.Background(), decReq)
		if err != nil || (resp != nil && resp.IsError()) {
			t.Fatalf("err:%v resp:%#v", err, resp)
		}

		if resp.Data["plaintext"] != plaintext {
			t.Fatalf("bad: plaintext. Expected: %q, Actual: %q", plaintext, resp.Data["plaintext"])
		}
	}

	// We expect 4 successful transit requests (2 for batch encryption, 2 for batch decryption)
	require.Equal(t, uint64(4), b.secretEngineCounts.Transit.MonthlyCount.Load())
}

// Case7: Test batch encryption with an upserted derived key
func TestTransit_BatchEncryptionCase7(t *testing.T) {
	var resp *logical.Response
	var err error

	b, s := createBackendWithStorage(t)

	batchInput := []interface{}{
		map[string]interface{}{"plaintext": "dGhlIHF1aWNrIGJyb3duIGZveA==", "context": "dmlzaGFsCg=="},
		map[string]interface{}{"plaintext": "dGhlIHF1aWNrIGJyb3duIGZveA==", "context": "dmlzaGFsCg=="},
	}

	batchData := map[string]interface{}{
		"batch_input": batchInput,
	}
	batchReq := &logical.Request{
		Operation: logical.CreateOperation,
		Path:      "encrypt/upserted_key",
		Storage:   s,
		Data:      batchData,
	}
	resp, err = b.HandleRequest(context.Background(), batchReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	batchResponseItems := resp.Data["batch_results"].([]EncryptBatchResponseItem)

	decReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "decrypt/upserted_key",
		Storage:   s,
	}

	plaintext := "dGhlIHF1aWNrIGJyb3duIGZveA=="

	for _, item := range batchResponseItems {
		if item.KeyVersion != 1 {
			t.Fatalf("unexpected key version; got: %d, expected: %d", item.KeyVersion, 1)
		}

		decReq.Data = map[string]interface{}{
			"ciphertext": item.Ciphertext,
			"context":    "dmlzaGFsCg==",
		}
		resp, err = b.HandleRequest(context.Background(), decReq)
		if err != nil || (resp != nil && resp.IsError()) {
			t.Fatalf("err:%v resp:%#v", err, resp)
		}

		if resp.Data["plaintext"] != plaintext {
			t.Fatalf("bad: plaintext. Expected: %q, Actual: %q", plaintext, resp.Data["plaintext"])
		}
	}
	// We expect 4 successful transit requests (2 for batch encryption, 2 for batch decryption)
	require.Equal(t, uint64(4), b.secretEngineCounts.Transit.MonthlyCount.Load())
}

// Case8: If plaintext is not base64 encoded, encryption should fail
func TestTransit_BatchEncryptionCase8(t *testing.T) {
	var resp *logical.Response
	var err error

	b, s := createBackendWithStorage(t)

	// Create the policy
	policyReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "keys/existing_key",
		Storage:   s,
	}
	resp, err = b.HandleRequest(context.Background(), policyReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	batchInput := []interface{}{
		map[string]interface{}{"plaintext": "simple_plaintext"},
	}
	batchData := map[string]interface{}{
		"batch_input": batchInput,
	}
	batchReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "encrypt/existing_key",
		Storage:   s,
		Data:      batchData,
	}
	resp, err = b.HandleRequest(context.Background(), batchReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	plaintext := "simple plaintext"

	encData := map[string]interface{}{
		"plaintext": plaintext,
	}

	encReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "encrypt/existing_key",
		Storage:   s,
		Data:      encData,
	}
	resp, err = b.HandleRequest(context.Background(), encReq)
	if err == nil {
		t.Fatal("expected an error")
	}
	// We expect 0 successful transit requests
	require.Equal(t, uint64(0), b.secretEngineCounts.Transit.MonthlyCount.Load())
}

// Case9: If both plaintext and batch inputs are supplied, plaintext should be
// ignored.
func TestTransit_BatchEncryptionCase9(t *testing.T) {
	var resp *logical.Response
	var err error

	b, s := createBackendWithStorage(t)

	batchInput := []interface{}{
		map[string]interface{}{"plaintext": "dGhlIHF1aWNrIGJyb3duIGZveA=="},
		map[string]interface{}{"plaintext": "dGhlIHF1aWNrIGJyb3duIGZveA=="},
	}
	plaintext := "dGhlIHF1aWNrIGJyb3duIGZveA=="
	batchData := map[string]interface{}{
		"batch_input": batchInput,
		"plaintext":   plaintext,
	}
	batchReq := &logical.Request{
		Operation: logical.CreateOperation,
		Path:      "encrypt/upserted_key",
		Storage:   s,
		Data:      batchData,
	}
	resp, err = b.HandleRequest(context.Background(), batchReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	_, ok := resp.Data["ciphertext"]
	if ok {
		t.Fatal("ciphertext field should not be set")
	}

	// We expect 2 successful batch encryptions
	require.Equal(t, uint64(2), b.secretEngineCounts.Transit.MonthlyCount.Load())
}

// Case10: Inconsistent presence of 'context' in batch input should be caught
func TestTransit_BatchEncryptionCase10(t *testing.T) {
	var err error

	b, s := createBackendWithStorage(t)

	batchInput := []interface{}{
		map[string]interface{}{"plaintext": "dGhlIHF1aWNrIGJyb3duIGZveA=="},
		map[string]interface{}{"plaintext": "dGhlIHF1aWNrIGJyb3duIGZveA==", "context": "dmlzaGFsCg=="},
	}

	batchData := map[string]interface{}{
		"batch_input": batchInput,
	}

	batchReq := &logical.Request{
		Operation: logical.CreateOperation,
		Path:      "encrypt/upserted_key",
		Storage:   s,
		Data:      batchData,
	}
	_, err = b.HandleRequest(context.Background(), batchReq)
	if err == nil {
		t.Fatalf("expected an error")
	}
	// We expect no successful transit requests
	require.Equal(t, uint64(0), b.secretEngineCounts.Transit.MonthlyCount.Load())
}

// Case11: Incorrect inputs for context and nonce should not fail the operation
func TestTransit_BatchEncryptionCase11(t *testing.T) {
	var err error

	b, s := createBackendWithStorage(t)

	batchInput := []interface{}{
		map[string]interface{}{"plaintext": "dGhlIHF1aWNrIGJyb3duIGZveA==", "context": "dmlzaGFsCg=="},
		map[string]interface{}{"plaintext": "dGhlIHF1aWNrIGJyb3duIGZveA==", "context": "not-encoded"},
	}

	batchData := map[string]interface{}{
		"batch_input": batchInput,
	}
	batchReq := &logical.Request{
		Operation: logical.CreateOperation,
		Path:      "encrypt/upserted_key",
		Storage:   s,
		Data:      batchData,
	}
	_, err = b.HandleRequest(context.Background(), batchReq)
	if err != nil {
		t.Fatal(err)
	}
	// We expect 1 successful encryption out of the 2-item batch
	require.Equal(t, uint64(1), b.secretEngineCounts.Transit.MonthlyCount.Load())
}

// Case12: Invalid batch input
func TestTransit_BatchEncryptionCase12(t *testing.T) {
	var err error
	b, s := createBackendWithStorage(t)

	batchInput := []interface{}{
		map[string]interface{}{},
		"unexpected_interface",
	}

	batchData := map[string]interface{}{
		"batch_input": batchInput,
	}
	batchReq := &logical.Request{
		Operation: logical.CreateOperation,
		Path:      "encrypt/upserted_key",
		Storage:   s,
		Data:      batchData,
	}
	_, err = b.HandleRequest(context.Background(), batchReq)
	if err == nil {
		t.Fatalf("expected an error")
	}
	// We expect no successful requests
	require.Equal(t, uint64(0), b.secretEngineCounts.Transit.MonthlyCount.Load())
}

// Case13: Incorrect input for nonce when we aren't in convergent encryption should fail the operation
func TestTransit_EncryptionCase13(t *testing.T) {
	var err error

	b, s := createBackendWithStorage(t)

	// Non-batch first
	data := map[string]interface{}{"plaintext": "bXkgc2VjcmV0IGRhdGE=", "nonce": "R80hr9eNUIuFV52e"}
	req := &logical.Request{
		Operation: logical.CreateOperation,
		Path:      "encrypt/my-key",
		Storage:   s,
		Data:      data,
	}
	resp, err := b.HandleRequest(context.Background(), req)
	if err == nil {
		t.Fatal("expected invalid request")
	}

	batchInput := []interface{}{
		map[string]interface{}{"plaintext": "bXkgc2VjcmV0IGRhdGE=", "nonce": "R80hr9eNUIuFV52e"},
	}

	batchData := map[string]interface{}{
		"batch_input": batchInput,
	}
	batchReq := &logical.Request{
		Operation: logical.CreateOperation,
		Path:      "encrypt/my-key",
		Storage:   s,
		Data:      batchData,
	}
	resp, err = b.HandleRequest(context.Background(), batchReq)
	if err != nil {
		t.Fatal(err)
	}

	if v, ok := resp.Data["http_status_code"]; !ok || v.(int) != http.StatusBadRequest {
		t.Fatal("expected request error")
	}
	// We expect no successful transit requests
	require.Equal(t, uint64(0), b.secretEngineCounts.Transit.MonthlyCount.Load())
}

// Case14: Incorrect input for nonce when we are in convergent version 3 should fail
func TestTransit_EncryptionCase14(t *testing.T) {
	var err error

	b, s := createBackendWithStorage(t)

	cReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "keys/my-key",
		Storage:   s,
		Data: map[string]interface{}{
			"convergent_encryption": "true",
			"derived":               "true",
		},
	}
	resp, err := b.HandleRequest(context.Background(), cReq)
	if err != nil {
		t.Fatal(err)
	}

	// Non-batch first
	data := map[string]interface{}{"plaintext": "bXkgc2VjcmV0IGRhdGE=", "context": "SGVsbG8sIFdvcmxkCg==", "nonce": "R80hr9eNUIuFV52e"}
	req := &logical.Request{
		Operation: logical.CreateOperation,
		Path:      "encrypt/my-key",
		Storage:   s,
		Data:      data,
	}

	resp, err = b.HandleRequest(context.Background(), req)
	if err == nil {
		t.Fatal("expected invalid request")
	}

	batchInput := []interface{}{
		data,
	}

	batchData := map[string]interface{}{
		"batch_input": batchInput,
	}
	batchReq := &logical.Request{
		Operation: logical.CreateOperation,
		Path:      "encrypt/my-key",
		Storage:   s,
		Data:      batchData,
	}
	resp, err = b.HandleRequest(context.Background(), batchReq)
	if err != nil {
		t.Fatal(err)
	}

	if v, ok := resp.Data["http_status_code"]; !ok || v.(int) != http.StatusBadRequest {
		t.Fatal("expected request error")
	}
	// We expect no successful transit requests
	require.Equal(t, uint64(0), b.secretEngineCounts.Transit.MonthlyCount.Load())
}

// Test that the fast path function decodeBatchRequestItems behave like mapstructure.Decode() to decode []BatchRequestItem.
func TestTransit_decodeBatchRequestItems(t *testing.T) {
	tests := []struct {
		name              string
		src               interface{}
		requirePlaintext  bool
		requireCiphertext bool
		dest              []BatchRequestItem
		wantErrContains   string
	}{
		// basic edge cases of nil values
		{name: "nil-nil", src: nil, dest: nil},
		{name: "nil-empty", src: nil, dest: []BatchRequestItem{}},
		{name: "empty-nil", src: []interface{}{}, dest: nil},
		{
			name: "src-nil",
			src:  []interface{}{map[string]interface{}{}},
			dest: nil,
		},
		// empty src & dest
		{
			name: "src-dest",
			src:  []interface{}{map[string]interface{}{}},
			dest: []BatchRequestItem{},
		},
		// empty src but with already populated dest, mapstructure discard pre-populated data.
		{
			name: "src-dest_pre_filled",
			src:  []interface{}{map[string]interface{}{}},
			dest: []BatchRequestItem{{}},
		},
		// two test per properties to test valid and invalid input
		{
			name: "src_plaintext-dest",
			src:  []interface{}{map[string]interface{}{"plaintext": "dGhlIHF1aWNrIGJyb3duIGZveA=="}},
			dest: []BatchRequestItem{},
		},
		{
			name:            "src_plaintext_invalid-dest",
			src:             []interface{}{map[string]interface{}{"plaintext": 666}},
			dest:            []BatchRequestItem{},
			wantErrContains: "expected type 'string', got unconvertible type 'int'",
		},
		{
			name: "src_ciphertext-dest",
			src:  []interface{}{map[string]interface{}{"ciphertext": "dGhlIHF1aWNrIGJyb3duIGZveA=="}},
			dest: []BatchRequestItem{},
		},
		{
			name:            "src_ciphertext_invalid-dest",
			src:             []interface{}{map[string]interface{}{"ciphertext": 666}},
			dest:            []BatchRequestItem{},
			wantErrContains: "expected type 'string', got unconvertible type 'int'",
		},
		{
			name: "src_key_version-dest",
			src:  []interface{}{map[string]interface{}{"key_version": 1}},
			dest: []BatchRequestItem{},
		},
		{
			name:            "src_key_version_invalid-dest",
			src:             []interface{}{map[string]interface{}{"key_version": "666"}},
			dest:            []BatchRequestItem{},
			wantErrContains: "expected type 'int', got unconvertible type 'string'",
		},
		{
			name:            "src_key_version_invalid-number-dest",
			src:             []interface{}{map[string]interface{}{"plaintext": "dGhlIHF1aWNrIGJyb3duIGZveA==", "key_version": json.Number("1.1")}},
			dest:            []BatchRequestItem{},
			wantErrContains: "error decoding json.Number into [0].key_version",
		},
		{
			name: "src_nonce-dest",
			src:  []interface{}{map[string]interface{}{"nonce": "dGVzdGNvbnRleHQ="}},
			dest: []BatchRequestItem{},
		},
		{
			name:            "src_nonce_invalid-dest",
			src:             []interface{}{map[string]interface{}{"nonce": 666}},
			dest:            []BatchRequestItem{},
			wantErrContains: "expected type 'string', got unconvertible type 'int'",
		},
		{
			name: "src_context-dest",
			src:  []interface{}{map[string]interface{}{"context": "dGVzdGNvbnRleHQ="}},
			dest: []BatchRequestItem{},
		},
		{
			name:            "src_context_invalid-dest",
			src:             []interface{}{map[string]interface{}{"context": 666}},
			dest:            []BatchRequestItem{},
			wantErrContains: "expected type 'string', got unconvertible type 'int'",
		},
		{
			name: "src_multi_order-dest",
			src: []interface{}{
				map[string]interface{}{"context": "1"},
				map[string]interface{}{"context": "2"},
				map[string]interface{}{"context": "3"},
			},
			dest: []BatchRequestItem{},
		},
		{
			name: "src_multi_with_invalid-dest",
			src: []interface{}{
				map[string]interface{}{"context": "1"},
				map[string]interface{}{"context": "2", "key_version": "666"},
				map[string]interface{}{"context": "3"},
			},
			dest:            []BatchRequestItem{},
			wantErrContains: "expected type 'int', got unconvertible type 'string'",
		},
		{
			name: "src_multi_with_multi_invalid-dest",
			src: []interface{}{
				map[string]interface{}{"context": "1"},
				map[string]interface{}{"context": "2", "key_version": "666"},
				map[string]interface{}{"context": "3", "key_version": "1337"},
			},
			dest:            []BatchRequestItem{},
			wantErrContains: "expected type 'int', got unconvertible type 'string'",
		},
		{
			name: "src_plaintext-nil-nonce",
			src:  []interface{}{map[string]interface{}{"plaintext": "dGhlIHF1aWNrIGJyb3duIGZveA==", "nonce": "null"}},
			dest: []BatchRequestItem{},
		},
		// required fields
		{
			name:             "required_plaintext_present",
			src:              []interface{}{map[string]interface{}{"plaintext": ""}},
			requirePlaintext: true,
			dest:             []BatchRequestItem{},
		},
		{
			name:             "required_plaintext_missing",
			src:              []interface{}{map[string]interface{}{}},
			requirePlaintext: true,
			dest:             []BatchRequestItem{},
			wantErrContains:  "missing plaintext",
		},
		{
			name:              "required_ciphertext_present",
			src:               []interface{}{map[string]interface{}{"ciphertext": "dGhlIHF1aWNrIGJyb3duIGZveA=="}},
			requireCiphertext: true,
			dest:              []BatchRequestItem{},
		},
		{
			name:              "required_ciphertext_missing",
			src:               []interface{}{map[string]interface{}{}},
			requireCiphertext: true,
			dest:              []BatchRequestItem{},
			wantErrContains:   "missing ciphertext",
		},
		{
			name:              "required_plaintext_and_ciphertext_missing",
			src:               []interface{}{map[string]interface{}{}},
			requirePlaintext:  true,
			requireCiphertext: true,
			dest:              []BatchRequestItem{},
			wantErrContains:   "missing ciphertext",
		},
		{
			name: "src_padding_scheme-dest",
			src:  []interface{}{map[string]interface{}{"padding_scheme": "oaep"}},
			dest: []BatchRequestItem{},
		},
		{
			name:            "src_padding_scheme_invalid-dest",
			src:             []interface{}{map[string]interface{}{"padding_scheme": 3}},
			dest:            []BatchRequestItem{},
			wantErrContains: "expected type 'string', got unconvertible type 'int'",
		},
		// hash_algorithm field
		{
			name: "src_hash_algorithm-dest",
			src:  []interface{}{map[string]interface{}{"hash_algorithm": "sha2-256"}},
			dest: []BatchRequestItem{},
		},
		{
			name:            "src_hash_algorithm_invalid-dest",
			src:             []interface{}{map[string]interface{}{"hash_algorithm": 8}},
			dest:            []BatchRequestItem{},
			wantErrContains: "expected type 'string', got unconvertible type 'int'",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			expectedDest := append(tt.dest[:0:0], tt.dest...) // copy of the dest state
			expectedErr := mapstructure.Decode(tt.src, &expectedDest) != nil || tt.wantErrContains != ""

			gotErr := decodeBatchRequestItems(tt.src, tt.requirePlaintext, tt.requireCiphertext, &tt.dest)
			gotDest := tt.dest

			if expectedErr {
				if gotErr == nil {
					t.Fatal("decodeBatchRequestItems unexpected error value; expected error but got none")
				}
				if tt.wantErrContains == "" {
					t.Fatal("missing error condition")
				}
				if !strings.Contains(gotErr.Error(), tt.wantErrContains) {
					t.Errorf("decodeBatchRequestItems unexpected error value, want err contains: '%v', got: '%v'", tt.wantErrContains, gotErr)
				}
			}

			if !reflect.DeepEqual(expectedDest, gotDest) {
				t.Errorf("decodeBatchRequestItems unexpected dest value, want: '%v', got: '%v'", expectedDest, gotDest)
			}
		})
	}
}

func TestShouldWarnAboutNonceUsage(t *testing.T) {
	tests := []struct {
		name                 string
		keyTypes             []keysutil.KeyType
		nonce                []byte
		convergentEncryption bool
		convergentVersion    int
		expected             bool
	}{
		{
			name:                 "-NoConvergent-WithNonce",
			keyTypes:             []keysutil.KeyType{keysutil.KeyType_AES256_GCM96, keysutil.KeyType_AES128_GCM96, keysutil.KeyType_ChaCha20_Poly1305},
			nonce:                []byte("testnonce"),
			convergentEncryption: false,
			convergentVersion:    -1,
			expected:             true,
		},
		{
			name:                 "-NoConvergent-NoNonce",
			keyTypes:             []keysutil.KeyType{keysutil.KeyType_AES256_GCM96, keysutil.KeyType_AES128_GCM96, keysutil.KeyType_ChaCha20_Poly1305},
			nonce:                []byte{},
			convergentEncryption: false,
			convergentVersion:    -1,
			expected:             false,
		},
		{
			name:                 "-Convergentv1-WithNonce",
			keyTypes:             []keysutil.KeyType{keysutil.KeyType_AES256_GCM96, keysutil.KeyType_AES128_GCM96, keysutil.KeyType_ChaCha20_Poly1305},
			nonce:                []byte("testnonce"),
			convergentEncryption: true,
			convergentVersion:    1,
			expected:             true,
		},
		{
			name:                 "-Convergentv2-WithNonce",
			keyTypes:             []keysutil.KeyType{keysutil.KeyType_AES256_GCM96, keysutil.KeyType_AES128_GCM96, keysutil.KeyType_ChaCha20_Poly1305},
			nonce:                []byte("testnonce"),
			convergentEncryption: true,
			convergentVersion:    2,
			expected:             false,
		},
		{
			name:                 "-Convergentv3-WithNonce",
			keyTypes:             []keysutil.KeyType{keysutil.KeyType_AES256_GCM96, keysutil.KeyType_AES128_GCM96, keysutil.KeyType_ChaCha20_Poly1305},
			nonce:                []byte("testnonce"),
			convergentEncryption: true,
			convergentVersion:    3,
			expected:             false,
		},
		{
			name:                 "-NoConvergent-WithNonce",
			keyTypes:             []keysutil.KeyType{keysutil.KeyType_RSA2048, keysutil.KeyType_RSA4096},
			nonce:                []byte("testnonce"),
			convergentEncryption: false,
			convergentVersion:    -1,
			expected:             false,
		},
	}

	for _, tt := range tests {
		for _, keyType := range tt.keyTypes {
			testName := keyType.String() + tt.name
			t.Run(testName, func(t *testing.T) {
				p := keysutil.Policy{
					ConvergentEncryption: tt.convergentEncryption,
					ConvergentVersion:    tt.convergentVersion,
					Type:                 keyType,
				}

				actual := shouldWarnAboutNonceUsage(&p, tt.nonce)

				if actual != tt.expected {
					t.Errorf("Expected actual '%v' but got '%v'", tt.expected, actual)
				}
			})
		}
	}
}

func TestTransit_EncryptWithRSAPublicKey(t *testing.T) {
	generateKeys(t)
	b, s := createBackendWithStorage(t)
	keyType := "rsa-2048"
	keyID, err := uuid.GenerateUUID()
	if err != nil {
		t.Fatalf("failed to generate key ID: %s", err)
	}

	// Get key
	privateKey := getKey(t, keyType)
	publicKeyBytes, err := getPublicKey(privateKey, keyType)
	if err != nil {
		t.Fatal(err)
	}

	// Import key
	req := &logical.Request{
		Storage:   s,
		Operation: logical.UpdateOperation,
		Path:      fmt.Sprintf("keys/%s/import", keyID),
		Data: map[string]interface{}{
			"public_key": publicKeyBytes,
			"type":       keyType,
		},
	}
	_, err = b.HandleRequest(context.Background(), req)
	if err != nil {
		t.Fatalf("failed to import public key: %s", err)
	}

	req = &logical.Request{
		Operation: logical.CreateOperation,
		Path:      fmt.Sprintf("encrypt/%s", keyID),
		Storage:   s,
		Data: map[string]interface{}{
			"plaintext": "bXkgc2VjcmV0IGRhdGE=",
		},
	}
	_, err = b.HandleRequest(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
}

// --- FIPS enforcement for ChaCha20-Poly1305 (WO-042) ---
//
// AC1: encrypt requests against a ChaCha20-Poly1305 key must be rejected
// (HTTP 400 / logical.ErrInvalidRequest) under FIPS mode. AC2: decrypt
// requests against existing ChaCha20-Poly1305 ciphertext must keep
// succeeding under FIPS mode. The reject assertion is written using the
// same runtime constants.IsFIPS() check path_sign_verify_test.go uses to
// skip its sha3 cases under FIPS: this file carries no build tag, so it
// always compiles, and constants.IsFIPS() only reports true on a build
// where the root module's FIPS detection is wired up.
//
// NOTE: as of this story, github.com/hashicorp/vault/helper/constants has
// no fips-tagged implementation of IsFIPS() -- only the !fips one exists
// at the root module -- so `go build/test -tags fips ./...` does not
// currently compile for any root-module package, including this one. That
// is pre-existing and independent of this story (confirmed via `git stash`
// before making any changes here); wiring a real root-level FIPS build is
// tracked separately. The actual encrypt-vs-decrypt enforcement lives in,
// and is fully exercised under `go test -tags fips` at, sdk/helper/keysutil
// (see policy_fips_test.go, which does compile and run standalone since it
// mirrors isFIPSMode() locally rather than depending on this predicate).
// The reject branch below therefore skips today and will start exercising
// once the root-level wiring lands; the decrypt-succeeds assertion is
// unconditional and runs today, proving the transit HTTP layer's
// backward-compatible read path is intact.
func TestTransit_FIPS_ChaCha20Poly1305_EncryptRejectDecryptSucceed(t *testing.T) {
	b, s := createBackendWithStorage(t)

	// Create a chacha20-poly1305 key. Key creation is itself gated by
	// WO-027 under FIPS mode, but this test runs on the default (non-FIPS)
	// build, so creation succeeds here exactly as it would have for an
	// operator's key created before FIPS mode was ever enabled.
	keyReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "keys/chacha-key",
		Storage:   s,
		Data: map[string]interface{}{
			"type": "chacha20-poly1305",
		},
	}
	resp, err := b.HandleRequest(context.Background(), keyReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	plaintext := base64.StdEncoding.EncodeToString([]byte("fips-integration-plaintext"))

	// Produce an existing ciphertext to exercise the decrypt-succeeds half
	// (AC2). This encrypt call happens outside FIPS mode, exactly as it
	// would for data written prior to a FIPS-mode migration.
	encReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "encrypt/chacha-key",
		Storage:   s,
		Data:      map[string]interface{}{"plaintext": plaintext},
	}
	resp, err = b.HandleRequest(context.Background(), encReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}
	ciphertext, ok := resp.Data["ciphertext"].(string)
	if !ok || ciphertext == "" {
		t.Fatalf("expected ciphertext in response, got: %#v", resp.Data)
	}

	// AC2: decrypting existing ChaCha20-Poly1305 ciphertext must succeed
	// regardless of FIPS mode.
	decReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "decrypt/chacha-key",
		Storage:   s,
		Data:      map[string]interface{}{"ciphertext": ciphertext},
	}
	resp, err = b.HandleRequest(context.Background(), decReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("decrypt of existing chacha20-poly1305 ciphertext must succeed: err:%v resp:%#v", err, resp)
	}
	if resp.Data["plaintext"] != plaintext {
		t.Fatalf("unexpected plaintext: got %v, want %v", resp.Data["plaintext"], plaintext)
	}

	// AC1: new encryption against a ChaCha20-Poly1305 key must be rejected
	// under FIPS mode. See the file-level comment above for why this only
	// exercises today once constants.IsFIPS() can report true.
	if !constants.IsFIPS() {
		t.Skip("constants.IsFIPS() is false on this build; the FIPS-mode encrypt-reject path is proven at sdk/helper/keysutil under -tags fips (see policy_fips_test.go's TestPolicy_FIPS_RejectsChaCha20Encrypt)")
	}

	rejectReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "encrypt/chacha-key",
		Storage:   s,
		Data:      map[string]interface{}{"plaintext": plaintext},
	}
	resp, err = b.HandleRequest(context.Background(), rejectReq)
	if err == nil {
		t.Fatalf("expected FIPS-mode encrypt rejection, got resp:%#v", resp)
	}
	if !errors.Is(err, logical.ErrInvalidRequest) {
		t.Fatalf("expected logical.ErrInvalidRequest (HTTP 400), got: %v", err)
	}
	errMsg, _ := resp.Data["error"].(string)
	if !strings.Contains(errMsg, "not permitted for encryption in FIPS mode") {
		t.Fatalf("expected FIPS-mode rejection message, got resp:%#v", resp)
	}
}

// TestTransit_FIPS_BatchEncrypt_MixedKeyTypesFailsWhole covers the WO-042
// edge case: "A batch encrypt request where some items use
// ChaCha20-Poly1305 and others use AES-GCM -- the entire batch should fail
// if any item targets a non-Approved key in FIPS mode." A single encrypt
// request is always scoped to one named key (encrypt/<name>), so "some
// items ChaCha20-Poly1305, others AES-GCM" happens via key_version: one
// key whose version 1 is chacha20-poly1305 and version 2 (after an
// algorithm-changing rotation, as in
// TestTransit_Rewrap_ChaCha20ToAESGCM_SameKeyVersion) is aes256-gcm96, with
// a batch that targets both versions in one request.
//
// No new handling is added for the "fails as a whole" part: batchRequestResponse
// (path_encrypt.go) already returns HTTP 400 for the whole response whenever
// any batch item errors (absent an opt-in partial_failure_response_code), so
// gating ChaCha20-Poly1305 in EncryptWithOptions is sufficient on its own.
// See the file-level comment on
// TestTransit_FIPS_ChaCha20Poly1305_EncryptRejectDecryptSucceed for why the
// reject branch here only exercises once constants.IsFIPS() can report
// true.
func TestTransit_FIPS_BatchEncrypt_MixedKeyTypesFailsWhole(t *testing.T) {
	if !constants.IsFIPS() {
		t.Skip("constants.IsFIPS() is false on this build; see TestTransit_FIPS_ChaCha20Poly1305_EncryptRejectDecryptSucceed's file-level comment")
	}

	b, s := createBackendWithStorage(t)

	keyReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "keys/mixed-key",
		Storage:   s,
		Data:      map[string]interface{}{"type": "chacha20-poly1305"},
	}
	resp, err := b.HandleRequest(context.Background(), keyReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	p, _, err := b.GetPolicy(context.Background(), keysutil.PolicyRequest{
		Storage: s,
		Name:    "mixed-key",
	}, b.GetRandomReader())
	if err != nil {
		t.Fatal(err)
	}
	if err := p.RotateWithAlgorithm(context.Background(), s, cryptoRand.Reader, keysutil.KeyType_AES256_GCM96, nil); err != nil {
		p.Unlock()
		t.Fatal(err)
	}
	p.Unlock()

	plaintext := base64.StdEncoding.EncodeToString([]byte("mixed-batch-plaintext"))
	batchReq := &logical.Request{
		Operation: logical.CreateOperation,
		Path:      "encrypt/mixed-key",
		Storage:   s,
		Data: map[string]interface{}{
			"batch_input": []interface{}{
				map[string]interface{}{"plaintext": plaintext, "key_version": 1}, // chacha20-poly1305, rejected
				map[string]interface{}{"plaintext": plaintext, "key_version": 2}, // aes256-gcm96, approved
			},
		},
	}
	resp, err = b.HandleRequest(context.Background(), batchReq)
	if err != nil {
		t.Fatal(err)
	}
	if v, ok := resp.Data["http_status_code"]; !ok || v.(int) != http.StatusBadRequest {
		t.Fatalf("expected the whole batch to fail with HTTP 400 because one item targets version 1 (chacha20-poly1305), got resp:%#v", resp)
	}

	batchResults, ok := resp.Data["batch_results"].([]EncryptBatchResponseItem)
	if !ok || len(batchResults) != 2 {
		t.Fatalf("expected 2 batch results, got resp:%#v", resp.Data)
	}
	if batchResults[0].Error == "" {
		t.Fatalf("expected the version-1 (chacha20-poly1305) item to error, got: %#v", batchResults[0])
	}
	if batchResults[1].Error != "" || batchResults[1].Ciphertext == "" {
		t.Fatalf("expected the version-2 (aes256-gcm96) item to succeed on its own, got: %#v", batchResults[1])
	}
}
