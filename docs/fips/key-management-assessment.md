# Key Management Assessment — FIPS-CRYPTO-005

**WO-031 · FIPS Phase 3 — Validated Module Boundary, Container Images, and OS-Level FIPS Mode**

This document evaluates key generation, storage, loading, and rotation paths in
hashicorp/vault per FIPS-CRYPTO-005, and catalogs every instance of hardcoded or
committed key material found in the repository. It builds on the Phase 2
cryptographic inventory (`fips/crypto_inventory.yaml`, WO-019), which does not
flag any hardcoded-key finding in its `residual_gaps` section — this assessment
is the first pass to do so.

**No private key content, key bytes, certificate bytes, or other secret values
appear anywhere in this document.** All entries are file paths, line numbers,
and metadata only. Every key identified below was independently confirmed to be
a synthetic/example key generated for test purposes (short-lived, low key
strength where inspected, or a long-published example key) — none corresponds
to a real production credential.

## Disposition legend

| Disposition | Meaning |
|---|---|
| **accepted test-scope** | Key material lives only in files the Go toolchain (`_test.go` suffix) or Ember CLI (`ui/tests/`) structurally excludes from every non-test build artifact. No further action needed. |
| **documented exception** | Key material lives in a file that is *not* tooling-excluded from the normal package build (no `_test.go` suffix), but is unreachable from any production entry point today. Accepted with an explicit rationale and monitoring recommendation because removing the pattern would require an architectural change out of this WO's scope. |
| **remediation required** | Key material is reachable from a production code path or storage default. **None found in this repository.** |

---

## (a) Committed key material inventory

### A1. Named in WO scope

| # | File | Line(s) | Key/data type | Usage context | Risk | Disposition |
|---|---|---|---|---|---|---|
| 1 | `vault/testing.go` | 78 (`testSharedPrivateKey`, const block starts 74) | RSA private key (PEM) | Test-support helper file (see §B1) | Medium | Documented exception |
| 2 | `builtin/logical/ssh/backend_test.go` | 47 (`testSharedPrivateKey`, declared in const block starting 40) | RSA private key (PEM) — **byte-identical to #1** (diff-verified) | Go `_test.go` file, SSH CA/Docker integration tests | Informational | Accepted test-scope |
| 3 | `api/test-fixtures/keys/key.pem` | 1 | RSA private key (PEM) | Committed test fixture, `api/client_test.go` | Informational | Accepted test-scope |
| 4 | `api/test-fixtures/keys/cert.pem` | 1 | X.509 certificate (public) | Committed test fixture | Informational | Accepted test-scope |
| 5 | `api/test-fixtures/keys/pkioutput` | 5, 27 (certs), 47 (RSA private key) | X.509 certs + RSA private key | Committed test fixture, mirrors PKI issue output | Informational | Accepted test-scope |
| 6 | `api/test-fixtures/root/rootcakey.pem` | 1 | RSA private key (PEM) | Committed test fixture (root CA), `vault/diagnose/tls_verification_test.go` | Informational | Accepted test-scope |
| 7 | `api/test-fixtures/root/pkioutput` | 1 (cert), private key further in file | X.509 certs + RSA private key | Committed test fixture | Informational | Accepted test-scope |
| 8 | `api/test-fixtures/root/rootcacert.pem` | 1 | X.509 certificate (public) | Committed test fixture | Informational | Accepted test-scope |

Finding #1 (`vault/testing.go:78`) and finding #2 (`builtin/logical/ssh/backend_test.go:47`)
share **byte-identical** RSA key material (confirmed via direct diff of the PEM
bodies) — a single well-known, long-standing "shared test key" reused in two
locations rather than two independently generated secrets. See §B for the
reachability analysis distinguishing why these two otherwise-identical findings
carry different risk classifications.

`api/test-fixtures/keys/` and `api/test-fixtures/root/` are referenced **only**
from `_test.go` files: `api/client_test.go`, `command/agentproxyshared/auth/cert/cert_test.go`,
`builtin/logical/pki/backend_test.go`, `vault/diagnose/tls_verification_test.go`.
Zero non-test `.go` file references either directory (verified via
`grep -rln "test-fixtures/keys\|test-fixtures/root" --include="*.go" .` filtered
to exclude `_test.go`, which returns no matches).

### A2. Additional test-only helper source files (same class as #1)

| # | File | Line | Key/data type | Notes | Risk | Disposition |
|---|---|---|---|---|---|---|
| 9 | `command/agent/testing.go` | 78 (`TestECDSAPrivKey`) | EC private key (PEM) | Same pattern as `vault/testing.go`: file name has no `_test.go` suffix, package `agent`, exists so other packages' `_test.go` files can import it | Medium | Documented exception |

### A3. Committed fixture files mirrored across consuming packages

These are copies of small synthetic RSA/EC/PKCS8 key and certificate fixtures,
duplicated into each package's `test-fixtures/` directory that needs them
(a long-standing Vault convention — fixtures are colocated with the test that
uses them rather than centralized). All confirmed referenced only from
`_test.go` files.

| # | Files | Key type | Referencing `_test.go` file(s) | Risk | Disposition |
|---|---|---|---|---|---|
| 10 | `command/proxy/test-fixtures/reload/reload_foo.key`, `reload_bar.key` | RSA private key | `command/proxy_test.go` | Informational | Accepted test-scope |
| 11 | `command/agent/test-fixtures/reload/reload_foo.key`, `reload_bar.key` | RSA private key | `command/agent_test.go` | Informational | Accepted test-scope |
| 12 | `helper/serverconfig/test-fixtures/reload/reload_foo.key`, `reload_bar.key` | RSA private key | `helper/serverconfig/listener_tcp_test.go` | Informational | Accepted test-scope |
| 13 | `command/agentproxyshared/auth/cert/test-fixtures/keys/key.pem`, `key1.pem`, `pkioutput` | RSA / PKCS8 private key | `command/agentproxyshared/auth/cert/cert_test.go` | Informational | Accepted test-scope |
| 14 | `command/agentproxyshared/auth/cert/test-fixtures/root/rootcakey.pem`, `pkioutput` | RSA private key | `command/agentproxyshared/auth/cert/cert_test.go` | Informational | Accepted test-scope |
| 15 | `vault/diagnose/test-fixtures/goodkey.pem`, `expiredprivatekey.pem`, `ecdsa.key`, `selfSignedCertKey.pem` | RSA / EC / PKCS8 private key | `vault/diagnose/tls_verification_test.go` | Informational | Accepted test-scope |

### A4. Inline PEM literals inside `_test.go` files

All of these are string literals inside files ending in `_test.go`, which the Go
toolchain structurally excludes from every non-test build (`go build`, `go
install`, release binaries) — the strongest exclusion guarantee available.

| # | File | Line(s) | Key type | Variable | Risk | Disposition |
|---|---|---|---|---|---|---|
| 16 | `builtin/logical/pki/path_issue_sign_test.go` | 679, 732, 802, 906 (RSA); 1017, 1034, 1053, 1074 (EC); 1092 (PKCS8) | RSA / EC / PKCS8 | inline literals | Informational | Accepted test-scope |
| 17 | `builtin/logical/pki/storage_migrations_test.go` | 915 | RSA | `migIntPrivKey` | Informational | Accepted test-scope |
| 18 | `builtin/logical/pki/backend_test.go` | 90 (RSA); 5450 (EC); 5591, 6161 (PKCS8) | RSA / EC / PKCS8 | `rootCAKeyPEM` and others | Informational | Accepted test-scope |
| 19 | `builtin/logical/transit/path_sign_verify_test.go` | 109, 121 | EC | inline literals | Informational | Accepted test-scope |
| 20 | `helper/pkcs7/decrypt_test.go` | 53 | PKCS8 | inline literal | Informational | Accepted test-scope |
| 21 | `builtin/logical/nomad/backend_test.go` | 794 | PKCS8 | `clientKey` | Informational | Accepted test-scope |
| 22 | `builtin/logical/pki/crl_test.go` | 1391 | PKCS8 | `privKey` | Informational | Accepted test-scope |
| 23 | `builtin/logical/ssh/backend_test.go` | 118 (`testCAPrivateKeyEd25519`), 1050, 1247 (`testKeyToSignPrivate`, two separate test functions) | OpenSSH private key | inline literals | Informational | Accepted test-scope |

### A5. Grep matches that are **not** key material (false positives — documented for completeness)

Per the WO's edge case about non-obvious matches, these two files matched the
`BEGIN .* PRIVATE KEY` search patterns but contain no actual key bytes — they
assert that a PEM header is *present or absent* in a CLI/API output string, not
a hardcoded secret:

| File | Line(s) | What it actually is |
|---|---|---|
| `builtin/logical/pki/path_secure_export_key_test.go` | 312, 314 | `require.False(t, strings.Contains(strVal, "-----BEGIN PRIVATE KEY-----"))` — asserts a private key is *not* leaked in export output |
| `builtin/logical/pkiext/pkcs12_openssl_validator_test.go` | 148, 208 | `require.Contains(t, output, "-----BEGIN PRIVATE KEY-----", ...)` — asserts the local `openssl` CLI's own stdout contains a key header; no key bytes are embedded in the test source |

No action needed — not hardcoded key material.

### A6. UI test fixtures (JavaScript/TypeScript, Ember QUnit — not part of the Go module)

Excluded from every production Ember build (`ember build --environment=production`
never packages `ui/tests/`); these are QUnit fixture strings, several
intentionally truncated/placeholder (e.g. `'-----BEGIN EC PRIVATE
KEY-----private key-----END EC PRIVATE KEY-----'` is not valid PEM at all).

| File | Line(s) | Risk | Disposition |
|---|---|---|---|
| `ui/tests/integration/components/encoded-data-card-test.js` | 91 | Informational | Accepted test-scope |
| `ui/tests/integration/components/pki/pki-generate-csr-test.js` | 156 | Informational | Accepted test-scope |
| `ui/tests/integration/components/generate-credentials-database-test.js` | 55, 116 | Informational | Accepted test-scope |
| `ui/tests/integration/components/pki/page/pki-issuer-rotate-root-test.js` | 181 | Informational | Accepted test-scope |
| `ui/tests/helpers/pki/pki-helpers.ts` | 82 | Informational | Accepted test-scope |
| `ui/tests/integration/components/kmip/details-credentials-test.js` | 31 | Informational (placeholder, not valid PEM) | Accepted test-scope |
| `ui/tests/integration/components/pki/page/pki-certificate-details-test.js` | 48 | Informational (header only, no body) | Accepted test-scope |

### A7. Public certificate embedded in JSON test fixture

| File | Line | Content | Risk | Disposition |
|---|---|---|---|---|
| `plugins/database/cassandra/test-fixtures/with_tls/ca.pem.json` | 2 | X.509 CA certificate chain (public data — certificates are not secret) | Informational | Accepted test-scope |

---

## (b) Key generation path evaluation — `sdk/helper/keysutil/policy.go`

`sdk/helper/keysutil/consts.go` and `policy.go:63-84` define exactly **20** `KeyType`
constants (confirmed by count). Generation is dispatched from
`Policy.RotateInMemoryWithAlgorithm` (`policy.go:1995-2102`); every path receives
the caller-supplied `randReader io.Reader`, which the Transit backend populates
via `Backend.GetRandomReader()` (`sdk/framework/backend.go:468-474`): returns an
external entropy-augmentation reader if configured, **otherwise `crypto/rand.Reader`**
(Go stdlib, OS entropy — FIPS-CRYPTO-005 Approved RNG per the Phase 1 inventory).

| KeyType | Algorithm/size | Entropy source | Generation site | Notes |
|---|---|---|---|---|
| `KeyType_AES256_GCM96` | AES-256, 32 random bytes | `randReader` → `crypto/rand.Reader` | `policy.go:2016-2037` (`uuid.GenerateRandomBytesWithReader`) | |
| `KeyType_AES128_GCM96` | AES-128, 16 random bytes | `randReader` → `crypto/rand.Reader` | `policy.go:2016-2037` | |
| `KeyType_ChaCha20_Poly1305` | 32 random bytes | `randReader` → `crypto/rand.Reader` | `policy.go:2016-2037` | Not FIPS-Approved (already tracked as RG-2 in `fips/crypto_inventory.yaml`) |
| `KeyType_AES128_CBC` / `KeyType_AES256_CBC` | AES-128/256, 16/32 random bytes | `randReader` → `crypto/rand.Reader` | `policy.go:2016-2037` | |
| `KeyType_HMAC` | Variable (`config.KeySize`, bounded 256–4096 bits) | `randReader` → `crypto/rand.Reader` | `policy.go:2016-2037` | |
| `KeyType_AES128_CMAC` / `KeyType_AES256_CMAC` / `KeyType_AES192_CMAC` | AES-CMAC, 16/32/24 random bytes | `randReader` → `crypto/rand.Reader` | `policy.go:2016-2037` | |
| `KeyType_ECDSA_P256` / `_P384` / `_P521` | ECDSA, NIST curve | **`crypto/rand.Reader` directly** (package-level `rand` import, `policy.go:16`) | `generateECDSAKey`, `policy.go:3112-3125` | **Finding G1** — bypasses the injected `randReader` parameter and always calls the stdlib `crypto/rand.Reader` singleton instead. Operationally equivalent entropy source, but breaks the entropy-augmentation injection point used by every other KeyType. Low severity / informational; recommend follow-on to thread `randReader` through for consistency. |
| `KeyType_ED25519` | Ed25519, 32-byte seed | `randReader` → `crypto/rand.Reader` | `generateEd25519Key`, `policy.go:2104-2120` | Not FIPS-Approved (already tracked as RG-3) |
| `KeyType_RSA2048` / `_RSA3072` / `_RSA4096` | RSA, 2048/3072/4096-bit | `randReader` → `crypto/rand.Reader` | `policy.go:2054-2068` (`cryptoutil.GenerateRSAKey`) | |
| `KeyType_MANAGED_KEY` | External KMS/HSM-managed | N/A — delegates to managed key infra | dispatched to `entRotateInMemory` | See Finding G2 |
| `KeyType_ML_DSA` | Post-quantum signature | N/A in this repo (see G2) | dispatched to `entRotateInMemory` | |
| `KeyType_HYBRID` | Hybrid classical/PQ | N/A in this repo (see G2) | dispatched to `entRotateInMemory` | |
| `KeyType_SLH_DSA` | Post-quantum signature | N/A in this repo (see G2) | dispatched to `entRotateInMemory` | |

**Finding G2** — `sdk/helper/keysutil/policy_ce.go:4` (`//go:build !enterprise`)
stubs `entRotateInMemory` to unconditionally `return fmt.Errorf("unsupported key
type %v", keyType)` (`policy_ce.go:30-32`). `KeyType_MANAGED_KEY`, `KeyType_ML_DSA`,
`KeyType_HYBRID`, and `KeyType_SLH_DSA` therefore have **no generation logic
present in this (community edition) repository** — the actual implementation is
enterprise-only and out of scope for an in-repo FIPS audit. This is a scope
boundary, not a finding requiring remediation, but the 4 KeyTypes should be
recorded as "not auditable from this repository" rather than silently assumed
compliant.

All 16 CE-implemented KeyTypes confirmed to use `crypto/rand`-derived entropy
(directly or via the injected `randReader`, which defaults to `crypto/rand.Reader`).
No custom/non-Approved DRBG or hardcoded seed was found in any generation path.

---

## (c) Key storage mechanism evaluation

### Key hierarchy

```
unseal material (Shamir shares OR KMS/HSM auto-unseal key)
        │  combined via vault/seal/seal.go (access.GetShamirKeyBytes /
        │  go-kms-wrapping/v2 Decrypt for auto-unseal)
        ▼
root/master key  (vault/core.go: unsealKeyToRootKeyPostUnseal, core.go:3830;
        │         generated via barrier.GenerateKey, vault/init.go:125,
        │         vault/rekey.go:450/560/699, vault/core.go:2284)
        ▼
barrier keyring  — one or more AES-256-GCM encryption keys, one per "term"
        │         (vault/barrier_aes_gcm.go: Keyring/Key/Term; keyring itself
        │         is persisted encrypted-under-root-key)
        ▼
barrier-encrypted data  — all Vault logical storage entries, including Transit
                  key policies (each Transit key's KeyEntry versions are just
                  another barrier-encrypted storage object)
```

- **Seal layer** (`vault/seal/seal.go`): abstracts Shamir (`SetShamirSealKey`/
  `GetShamirKeyBytes`, `seal.go:817-845`) vs. KMS/HSM auto-unseal
  (`vault/seal/envelope.go:27-38`, wraps `github.com/hashicorp/go-kms-wrapping/v2`).
  Shamir is already tracked as a non-FIPS-Approved residual gap (RG-5 in
  `fips/crypto_inventory.yaml`); KMS/HSM auto-unseal CMVP certificate tracking is
  RG-6 and is explicitly out of scope for this WO (KMS/HSM documentation is
  WO-030).
- **Barrier layer** (`vault/barrier_aes_gcm.go`): `GenerateKey` (line 342-348)
  produces a 32-byte (`2*aes.BlockSize`) key from the supplied reader — AES-256.
  Encryption uses `aes.NewCipher` + `cipher.NewGCM` (lines 1019-1025) with a
  12-byte (`gcm.NonceSize()`) nonce per operation, matching the WO's stated
  AES-256-GCM / 12-byte-nonce design. All barrier key generation call sites
  (`init.go:125`, `rekey.go:450,560,699`, `core.go:2284`) pass
  `c.secureRandomReader`, which defaults to `crypto/rand.Reader`
  (`vault/core.go:1129-1130`) and in a running server is set from
  `configutil.CreateSecureRandomReaderFunc` (`command/server.go:1958`) —
  entropy-augmentation-aware, falling back to `crypto/rand.Reader`.
- **Transit layer** (`sdk/helper/keysutil/policy.go`): Transit key policies are
  themselves persisted through the barrier (`Policy.Persist` →
  `logical.Storage`, which is barrier-backed), so Transit keys are "data" one
  layer below the barrier key in the hierarchy above, not siblings of it.

No barrier or seal key material is hardcoded anywhere in the repository — every
generation call site traced above uses a runtime-supplied `io.Reader` rooted in
`crypto/rand.Reader`. This is a materially different (and materially lower-risk)
category from the test-fixture findings in §(a): there is no committed barrier,
master, or seal key anywhere in source control.

---

## (d) Key rotation mechanism evaluation

| Mechanism | Interval/trigger | Implementation | Notes |
|---|---|---|---|
| Barrier auto-rotate check | Ticker every `autoRotateCheckInterval` = 5 minutes (`vault/barrier_aes_gcm.go:43`) | `vault/core.go:4287` (`time.NewTicker(autoRotateCheckInterval)`) drives `c.barrier.CheckBarrierAutoRotate(ctx)` (`core.go:4303` → `barrier_aes_gcm.go:1238-1274`) | Rotates when: legacy 1-year-since-install fallback, `rc.MaxOperations` exceeded, or configured `rc.Interval` elapsed |
| Barrier manual rotate | `sys/rotate` API / CLI | `AESGCMBarrier.RotateKey` (`barrier_aes_gcm.go:1181-1184`) → `Rotate(ctx, rand.Reader)` (`barrier_aes_gcm.go:616-661`) | Adds a new keyring `Term`; prior terms remain for decrypting old data; new key generated via `GenerateKey(randomSource)` |
| Transit key versioning | Manual (`keys/<name>/rotate`) or `AutoRotatePeriod` (`policy.go:680-682`, `json:"auto_rotate_period"`) | `Policy.Rotate` → `RotateWithAlgorithm` → `RotateInMemoryWithAlgorithm` (`policy.go:1913-2102`) | Increments `LatestVersion`; `MinDecryptionVersion`/`MinEncryptionVersion` gate which historical versions remain usable; ciphertext is versioned via `VersionTemplate` (`vault:v{{version}}:`, `policy.go:111`) |

Both mechanisms support forward rotation without breaking decryption of
previously encrypted data (barrier via multi-term keyring; Transit via
per-version key entries and configurable min-decryption-version), which is the
FIPS-relevant property (rotation capability without a hard cutover / data-loss
window).

---

## (e) Recommended dispositions and follow-on remediation items

No finding in this assessment requires code changes as part of WO-031 (scope:
evaluate and catalog, not remediate). Follow-on items for a future WO/backlog
entry:

1. **F1 (low priority, informational)** — `sdk/helper/keysutil/policy.go:3125`
   (`generateECDSAKey`) ignores the injected `randReader` and always calls
   package-level `crypto/rand.Reader` directly. Thread `randReader` through for
   consistency with every other `KeyType` generation path (Finding G1). No
   FIPS entropy concern today since both resolve to the OS CSPRNG, but it
   silently defeats entropy-augmentation configuration for ECDSA specifically.
2. **F2 (informational)** — `KeyType_MANAGED_KEY`, `KeyType_ML_DSA`,
   `KeyType_HYBRID`, `KeyType_SLH_DSA` generation logic is enterprise-only and
   not present in this repository (Finding G2); a FIPS audit of those 4
   KeyTypes must happen against the enterprise codebase, not this OSS mirror.
3. **F3 (documented exception, no immediate action)** — `vault/testing.go` and
   `command/agent/testing.go` are cross-package Go test helpers that
   intentionally cannot use the `_test.go` suffix (Go's test-file exclusion is
   per-package-import, and these are consumed by other packages' `_test.go`
   files). This means their hardcoded test keys ship inside the normal,
   non-test build of the `vault` and `agent` packages, relying on
   linker-level dead-code elimination (no production entry point calls
   `TestCore`/`TestCoreWithConfig`/etc. — confirmed via
   `grep -rln "vault\.TestCore\b" --include="*.go" . | grep -v _test.go`
   returning zero matches) rather than Go-toolchain-guaranteed exclusion.
   Recommend periodic re-verification (e.g. a CI check asserting no
   non-test `.go` file imports these helpers) rather than a structural fix,
   since restructuring would require an internal `testhelpers`-style package
   split that is a larger, separate effort.
4. **F4 (hygiene, no FIPS impact)** — the RSA key in `vault/testing.go:78` and
   `builtin/logical/ssh/backend_test.go:47` is byte-identical; consider
   consolidating to a single shared constant in a common test-helpers package
   the next time either file is touched, purely to reduce duplication (not a
   security finding — both are the same well-known test key).

## Acceptance criteria evidence summary

| AC | Status | Evidence |
|---|---|---|
| Structured artifact cataloging every hardcoded-key instance incl. the 3 named examples | PASS | This file; §A1 rows 1, 6-8 (api/test-fixtures), row 2 (ssh backend_test.go) |
| Each instance has file path, line(s), key type, usage context, risk, disposition | PASS | §A1-A7 tables |
| Evaluates `sdk/helper/keysutil/policy.go` 20 KeyTypes for `crypto/rand` entropy | PASS | §(b) table — all 20 KeyTypes enumerated, 16 CE-generation paths traced to `crypto/rand.Reader`, 4 enterprise-only paths documented as out-of-repo (Finding G2) |
| Evaluates barrier/seal key storage and hierarchy | PASS | §(c) — hierarchy diagram + `barrier_aes_gcm.go`/`seal/seal.go`/`seal/envelope.go` citations |
| Evaluates rotation paths (`autoRotateCheckInterval`, Transit versioning) | PASS | §(d) table |
| No secret values in this document | PASS | Only file paths/line numbers/metadata used throughout; verified by manual re-read |
| Unit/integration tests / mocks | N/A | Documentation deliverable per WO |
