// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: BUSL-1.1

package transit

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/hashicorp/vault/sdk/helper/jsonutil"
	"github.com/hashicorp/vault/sdk/logical"
	"github.com/mitchellh/mapstructure"
	"github.com/stretchr/testify/require"
)

func TestTransit_BatchDecryption(t *testing.T) {
	var resp *logical.Response
	var err error

	b, s := createBackendWithStorage(t)

	batchEncryptionInput := []interface{}{
		map[string]interface{}{"plaintext": "", "reference": "foo"},     // empty string
		map[string]interface{}{"plaintext": "Cg==", "reference": "bar"}, // newline
		map[string]interface{}{"plaintext": "dGhlIHF1aWNrIGJyb3duIGZveA==", "reference": "baz"},
	}
	batchEncryptionData := map[string]interface{}{
		"batch_input": batchEncryptionInput,
	}

	batchEncryptionReq := &logical.Request{
		Operation: logical.CreateOperation,
		Path:      "encrypt/upserted_key",
		Storage:   s,
		Data:      batchEncryptionData,
	}
	resp, err = b.HandleRequest(context.Background(), batchEncryptionReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	batchResponseItems := resp.Data["batch_results"].([]EncryptBatchResponseItem)
	batchDecryptionInput := make([]interface{}, len(batchResponseItems))
	for i, item := range batchResponseItems {
		batchDecryptionInput[i] = map[string]interface{}{"ciphertext": item.Ciphertext, "reference": item.Reference}
	}
	batchDecryptionData := map[string]interface{}{
		"batch_input": batchDecryptionInput,
	}

	batchDecryptionReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "decrypt/upserted_key",
		Storage:   s,
		Data:      batchDecryptionData,
	}
	resp, err = b.HandleRequest(context.Background(), batchDecryptionReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	batchDecryptionResponseItems := resp.Data["batch_results"].([]DecryptBatchResponseItem)
	// This seems fragile
	expectedResult := "[{\"plaintext\":\"\",\"reference\":\"foo\"},{\"plaintext\":\"Cg==\",\"reference\":\"bar\"},{\"plaintext\":\"dGhlIHF1aWNrIGJyb3duIGZveA==\",\"reference\":\"baz\"}]"

	jsonResponse, err := json.Marshal(batchDecryptionResponseItems)
	if err != nil {
		t.Fatalf("bad: failed to marshal response items: err=%v json=%s", err, jsonResponse)
	}
	if string(jsonResponse) != expectedResult {
		t.Fatalf("bad: expected json response [%s]", jsonResponse)
	}

	// We expect 6 successful requests (3 for batch encryption, 3 for batch decryption)
	require.Equal(t, uint64(6), b.secretEngineCounts.Transit.MonthlyCount.Load())
}

func TestTransit_BatchDecryption_DerivedKey(t *testing.T) {
	var req *logical.Request
	var resp *logical.Response
	var err error

	b, s := createBackendWithStorage(t)

	// Create a derived key.
	req = &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "keys/existing_key",
		Storage:   s,
		Data: map[string]interface{}{
			"derived": true,
		},
	}
	resp, err = b.HandleRequest(context.Background(), req)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	// Encrypt some values for use in test cases.
	plaintextItems := []struct {
		plaintext, context string
	}{
		{plaintext: "dGhlIHF1aWNrIGJyb3duIGZveA==", context: "dGVzdGNvbnRleHQ="},
		{plaintext: "anVtcGVkIG92ZXIgdGhlIGxhenkgZG9n", context: "dGVzdGNvbnRleHQy"},
	}
	req = &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "encrypt/existing_key",
		Storage:   s,
		Data: map[string]interface{}{
			"batch_input": []interface{}{
				map[string]interface{}{"plaintext": plaintextItems[0].plaintext, "context": plaintextItems[0].context},
				map[string]interface{}{"plaintext": plaintextItems[1].plaintext, "context": plaintextItems[1].context},
			},
		},
	}
	resp, err = b.HandleRequest(context.Background(), req)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	encryptedItems := resp.Data["batch_results"].([]EncryptBatchResponseItem)

	tests := []struct {
		name           string
		in             []interface{}
		want           []DecryptBatchResponseItem
		shouldErr      bool
		wantHTTPStatus int
		params         map[string]interface{}
	}{
		{
			name:      "nil-input",
			in:        nil,
			shouldErr: true,
		},
		{
			name:      "empty-input",
			in:        []interface{}{},
			shouldErr: true,
		},
		{
			name: "single-item-success",
			in: []interface{}{
				map[string]interface{}{"ciphertext": encryptedItems[0].Ciphertext, "context": plaintextItems[0].context},
			},
			want: []DecryptBatchResponseItem{
				{Plaintext: plaintextItems[0].plaintext},
			},
		},
		{
			name: "single-item-invalid-ciphertext",
			in: []interface{}{
				map[string]interface{}{"ciphertext": "xxx", "context": plaintextItems[0].context},
			},
			want: []DecryptBatchResponseItem{
				{Error: "invalid ciphertext: no prefix"},
			},
			wantHTTPStatus: http.StatusBadRequest,
		},
		{
			name: "single-item-wrong-context",
			in: []interface{}{
				map[string]interface{}{"ciphertext": encryptedItems[0].Ciphertext, "context": plaintextItems[1].context},
			},
			want: []DecryptBatchResponseItem{
				{Error: "cipher: message authentication failed"},
			},
			wantHTTPStatus: http.StatusBadRequest,
		},
		{
			name: "batch-full-success",
			in: []interface{}{
				map[string]interface{}{"ciphertext": encryptedItems[0].Ciphertext, "context": plaintextItems[0].context},
				map[string]interface{}{"ciphertext": encryptedItems[1].Ciphertext, "context": plaintextItems[1].context},
			},
			want: []DecryptBatchResponseItem{
				{Plaintext: plaintextItems[0].plaintext},
				{Plaintext: plaintextItems[1].plaintext},
			},
		},
		{
			name: "batch-partial-success",
			in: []interface{}{
				map[string]interface{}{"ciphertext": encryptedItems[0].Ciphertext, "context": plaintextItems[1].context},
				map[string]interface{}{"ciphertext": encryptedItems[1].Ciphertext, "context": plaintextItems[1].context},
			},
			want: []DecryptBatchResponseItem{
				{Error: "cipher: message authentication failed"},
				{Plaintext: plaintextItems[1].plaintext},
			},
			wantHTTPStatus: http.StatusBadRequest,
		},
		{
			name: "batch-partial-success-overridden-response",
			in: []interface{}{
				map[string]interface{}{"ciphertext": encryptedItems[0].Ciphertext, "context": plaintextItems[1].context},
				map[string]interface{}{"ciphertext": encryptedItems[1].Ciphertext, "context": plaintextItems[1].context},
			},
			want: []DecryptBatchResponseItem{
				{Error: "cipher: message authentication failed"},
				{Plaintext: plaintextItems[1].plaintext},
			},
			params:         map[string]interface{}{"partial_failure_response_code": http.StatusAccepted},
			wantHTTPStatus: http.StatusAccepted,
		},
		{
			name: "batch-full-failure",
			in: []interface{}{
				map[string]interface{}{"ciphertext": encryptedItems[0].Ciphertext, "context": plaintextItems[1].context},
				map[string]interface{}{"ciphertext": encryptedItems[1].Ciphertext, "context": plaintextItems[0].context},
			},
			want: []DecryptBatchResponseItem{
				{Error: "cipher: message authentication failed"},
				{Error: "cipher: message authentication failed"},
			},
			wantHTTPStatus: http.StatusBadRequest,
		},
		{
			name: "batch-full-failure-overridden-response",
			in: []interface{}{
				map[string]interface{}{"ciphertext": encryptedItems[0].Ciphertext, "context": plaintextItems[1].context},
				map[string]interface{}{"ciphertext": encryptedItems[1].Ciphertext, "context": plaintextItems[0].context},
			},
			want: []DecryptBatchResponseItem{
				{Error: "cipher: message authentication failed"},
				{Error: "cipher: message authentication failed"},
			},
			params: map[string]interface{}{"partial_failure_response_code": http.StatusAccepted},
			// Full failure, shouldn't affect status code
			wantHTTPStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req = &logical.Request{
				Operation: logical.UpdateOperation,
				Path:      "decrypt/existing_key",
				Storage:   s,
				Data: map[string]interface{}{
					"batch_input": tt.in,
				},
			}
			for k, v := range tt.params {
				req.Data[k] = v
			}
			resp, err = b.HandleRequest(context.Background(), req)

			didErr := err != nil || (resp != nil && resp.IsError())
			if didErr {
				if !tt.shouldErr {
					t.Fatalf("unexpected error err:%v, resp:%#v", err, resp)
				}
			} else {
				if tt.shouldErr {
					t.Fatal("expected error, but none occurred")
				}

				if rawRespBody, ok := resp.Data[logical.HTTPRawBody]; ok {
					httpResp := &logical.HTTPResponse{}
					err = jsonutil.DecodeJSON([]byte(rawRespBody.(string)), httpResp)
					if err != nil {
						t.Fatalf("failed to unmarshal nested response: err:%v, resp:%#v", err, resp)
					}

					if respStatus, ok := resp.Data[logical.HTTPStatusCode]; !ok || respStatus != tt.wantHTTPStatus {
						t.Fatalf("HTTP response status code mismatch, want:%d, got:%d", tt.wantHTTPStatus, respStatus)
					}

					resp = logical.HTTPResponseToLogicalResponse(httpResp)
				}

				var respItems []DecryptBatchResponseItem
				err = mapstructure.Decode(resp.Data["batch_results"], &respItems)
				if err != nil {
					t.Fatalf("problem decoding response items: err:%v, resp:%#v", err, resp)
				}
				if !reflect.DeepEqual(tt.want, respItems) {
					t.Fatalf("response items mismatch, want:%#v, got:%#v", tt.want, respItems)
				}
			}
		})
	}

	// We expect 7 successful requests (2 for batch encryption + 1 single-item decryption + 2 batch decryption + 2 batch decryption)
	require.Equal(t, uint64(7), b.secretEngineCounts.Transit.MonthlyCount.Load())
}

// TestTransit_decodeDecryptBatchRequestItems verifies that decodeBatchRequestItems
// correctly handles all fields — including the newer padding_scheme and
// hash_algorithm fields — when called via the decrypt path (requireCiphertext=true).
func TestTransit_decodeDecryptBatchRequestItems(t *testing.T) {
	tests := []struct {
		name            string
		src             interface{}
		dest            []BatchRequestItem
		wantErrContains string
	}{
		// Required ciphertext field
		{
			name:            "required_ciphertext_missing",
			src:             []interface{}{map[string]interface{}{}},
			dest:            []BatchRequestItem{},
			wantErrContains: "missing ciphertext",
		},
		{
			name: "required_ciphertext_present",
			src:  []interface{}{map[string]interface{}{"ciphertext": "vault:v1:abc"}},
			dest: []BatchRequestItem{},
		},
		// Invalid ciphertext type
		{
			name:            "src_ciphertext_invalid_type",
			src:             []interface{}{map[string]interface{}{"ciphertext": 666}},
			dest:            []BatchRequestItem{},
			wantErrContains: "expected type 'string', got unconvertible type 'int'",
		},
		// padding_scheme field
		{
			name: "src_padding_scheme_valid",
			src:  []interface{}{map[string]interface{}{"ciphertext": "vault:v1:abc", "padding_scheme": "oaep"}},
			dest: []BatchRequestItem{},
		},
		{
			name:            "src_padding_scheme_invalid_type",
			src:             []interface{}{map[string]interface{}{"ciphertext": "vault:v1:abc", "padding_scheme": 666}},
			dest:            []BatchRequestItem{},
			wantErrContains: "expected type 'string', got unconvertible type 'int'",
		},
		// hash_algorithm field
		{
			name: "src_hash_algorithm_valid",
			src:  []interface{}{map[string]interface{}{"ciphertext": "vault:v1:abc", "hash_algorithm": "sha2-256"}},
			dest: []BatchRequestItem{},
		},
		{
			name:            "src_hash_algorithm_invalid_type",
			src:             []interface{}{map[string]interface{}{"ciphertext": "vault:v1:abc", "hash_algorithm": 666}},
			dest:            []BatchRequestItem{},
			wantErrContains: "expected type 'string', got unconvertible type 'int'",
		},
		// Both fields together
		{
			name: "src_padding_scheme_and_hash_algorithm",
			src:  []interface{}{map[string]interface{}{"ciphertext": "vault:v1:abc", "padding_scheme": "oaep", "hash_algorithm": "sha2-512"}},
			dest: []BatchRequestItem{},
		},
		// Multiple items — error on one item does not hide the other
		{
			name: "multi_item_second_invalid",
			src: []interface{}{
				map[string]interface{}{"ciphertext": "vault:v1:abc", "padding_scheme": "oaep"},
				map[string]interface{}{"ciphertext": "vault:v1:abc", "padding_scheme": 666},
			},
			dest:            []BatchRequestItem{},
			wantErrContains: "expected type 'string', got unconvertible type 'int'",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			expectedDest := append(tt.dest[:0:0], tt.dest...)
			expectedErr := mapstructure.Decode(tt.src, &expectedDest) != nil || tt.wantErrContains != ""

			gotErr := decodeDecryptBatchRequestItems(tt.src, &tt.dest)

			if expectedErr {
				if gotErr == nil {
					t.Fatal("decodeDecryptBatchRequestItems: expected error but got none")
				}
				if tt.wantErrContains == "" {
					t.Fatal("missing wantErrContains for error case")
				}
				if !strings.Contains(gotErr.Error(), tt.wantErrContains) {
					t.Errorf("decodeDecryptBatchRequestItems: want error containing %q, got %q", tt.wantErrContains, gotErr.Error())
				}
			} else if gotErr != nil {
				t.Errorf("decodeDecryptBatchRequestItems: unexpected error: %v", gotErr)
			}

			if !reflect.DeepEqual(expectedDest, tt.dest) {
				t.Errorf("decodeDecryptBatchRequestItems: dest mismatch, want: %v, got: %v", expectedDest, tt.dest)
			}
		})
	}
}

// TestTransit_ChaCha20Poly1305_DecryptBackwardCompatible covers AC2/AC8
// (WO-042) from the decrypt endpoint's side: existing ChaCha20-Poly1305
// ciphertext -- both a single item and a batch -- must keep decrypting
// successfully. This is the backward-compatibility half of the story: it
// must hold regardless of FIPS mode, since Decrypt/DecryptWithOptions in
// sdk/helper/keysutil/policy.go is deliberately left without a FIPS gate
// (only Encrypt was gated; see path_encrypt_test.go's
// TestTransit_FIPS_ChaCha20Poly1305_EncryptRejectDecryptSucceed for the
// encrypt-side reject assertion).
func TestTransit_ChaCha20Poly1305_DecryptBackwardCompatible(t *testing.T) {
	b, s := createBackendWithStorage(t)

	keyReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "keys/chacha-key",
		Storage:   s,
		Data:      map[string]interface{}{"type": "chacha20-poly1305"},
	}
	resp, err := b.HandleRequest(context.Background(), keyReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}

	plaintexts := []string{"first-secret", "second-secret"}
	ciphertexts := make([]string, len(plaintexts))
	for i, pt := range plaintexts {
		encReq := &logical.Request{
			Operation: logical.UpdateOperation,
			Path:      "encrypt/chacha-key",
			Storage:   s,
			Data: map[string]interface{}{
				"plaintext": base64.StdEncoding.EncodeToString([]byte(pt)),
			},
		}
		resp, err = b.HandleRequest(context.Background(), encReq)
		if err != nil || (resp != nil && resp.IsError()) {
			t.Fatalf("err:%v resp:%#v", err, resp)
		}
		ciphertexts[i] = resp.Data["ciphertext"].(string)
	}

	// Single-item decrypt.
	decReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "decrypt/chacha-key",
		Storage:   s,
		Data:      map[string]interface{}{"ciphertext": ciphertexts[0]},
	}
	resp, err = b.HandleRequest(context.Background(), decReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}
	decoded, err := base64.StdEncoding.DecodeString(resp.Data["plaintext"].(string))
	if err != nil {
		t.Fatal(err)
	}
	if string(decoded) != plaintexts[0] {
		t.Fatalf("unexpected plaintext: got %q, want %q", decoded, plaintexts[0])
	}

	// Batch decrypt of multiple pre-existing ChaCha20-Poly1305 ciphertext
	// blobs in a single request.
	batchInput := make([]interface{}, len(ciphertexts))
	for i, ct := range ciphertexts {
		batchInput[i] = map[string]interface{}{"ciphertext": ct}
	}
	batchReq := &logical.Request{
		Operation: logical.UpdateOperation,
		Path:      "decrypt/chacha-key",
		Storage:   s,
		Data:      map[string]interface{}{"batch_input": batchInput},
	}
	resp, err = b.HandleRequest(context.Background(), batchReq)
	if err != nil || (resp != nil && resp.IsError()) {
		t.Fatalf("err:%v resp:%#v", err, resp)
	}
	batchResults := resp.Data["batch_results"].([]DecryptBatchResponseItem)
	if len(batchResults) != len(plaintexts) {
		t.Fatalf("expected %d batch results, got %d", len(plaintexts), len(batchResults))
	}
	for i, item := range batchResults {
		if item.Error != "" {
			t.Fatalf("batch item %d: unexpected error: %s", i, item.Error)
		}
		decoded, err := base64.StdEncoding.DecodeString(item.Plaintext)
		if err != nil {
			t.Fatal(err)
		}
		if string(decoded) != plaintexts[i] {
			t.Fatalf("batch item %d: unexpected plaintext: got %q, want %q", i, decoded, plaintexts[i])
		}
	}
}
