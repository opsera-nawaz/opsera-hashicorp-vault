# Runtime Crypto Provider and RNG/DRBG Compliance Verification — FIPS-CRYPTO-003, FIPS-CRYPTO-004

**WO-044 · FIPS Phase 2 — Approved-Algorithm Configuration and Enforcement**

Verified: 2026-09-28 · Repository: `opsera-nawaz/opsera-hashicorp-vault` · Branch: `feature/WO-044` · Commit: `6953ff5b57f92508cb9029c086848869543a9059` · Vault version: `2.2.0-beta1` · Go: `1.27.1` (`.go-version`, `go.mod:13`)

This document satisfies FIPS-CRYPTO-003 (verify the intended cryptographic
provider is actually selected and used at runtime, not just referenced in
source) and FIPS-CRYPTO-004 (verify RNG/DRBG usage traces to an SP 800-90A
Approved construction seeded from validated entropy). It builds on the Phase 1
consolidated inventory (`fips/crypto_inventory.yaml`, WO-019) and the CE
build-tag verification (`fips/inventory/ce_fips_build_tag_verification.yaml`,
WO-011). **This is a verification and documentation task only — no
cryptographic provider, RNG, or DRBG was added, removed, or modified by this
work order.**

## Result summary

| Question | Answer |
|---|---|
| Does the Community/OSS build select a CMVP-validated crypto provider at runtime? | **No.** Confirmed by grep, go.mod, CI, and `.release/security-scan.hcl` evidence below. This is a documented residual gap, not a defect introduced by this WO. |
| Do all security-relevant crypto operations use Go's stdlib `crypto/*` + `golang.org/x/crypto`? | **Yes**, in `sdk/helper/keysutil/policy.go` and everywhere else audited. |
| Does `crypto/rand.Reader` trace to a real kernel DRBG? | **Yes, but the specific DRBG construction is a property of the Linux kernel/Go runtime at deployment time, not of this source tree.** See the trace below. |
| Do any custom RNG/DRBG implementations exist in this codebase? | **No.** Grep audit found zero matches. |
| Is Entropy Augmentation correctly disabled under FIPS mode? | **Yes** — `command/server.go`, verified and now unit-tested (this WO). |

---

## 1. Crypto provider inventory — `sdk/helper/keysutil/policy.go` (FIPS-CRYPTO-003)

`sdk/helper/keysutil/policy.go:6-47` imports exclusively Go stdlib `crypto/*`
packages plus `golang.org/x/crypto` for algorithms stdlib does not provide:

```
sdk/helper/keysutil/policy.go:9   "crypto"
sdk/helper/keysutil/policy.go:10  "crypto/aes"
sdk/helper/keysutil/policy.go:11  "crypto/cipher"
sdk/helper/keysutil/policy.go:12  "crypto/ecdsa"
sdk/helper/keysutil/policy.go:13  stdlibEd25519 "crypto/ed25519"
sdk/helper/keysutil/policy.go:14  "crypto/elliptic"
sdk/helper/keysutil/policy.go:15  "crypto/hmac"
sdk/helper/keysutil/policy.go:16  "crypto/rand"
sdk/helper/keysutil/policy.go:17  "crypto/rsa"
sdk/helper/keysutil/policy.go:18  "crypto/sha256"
sdk/helper/keysutil/policy.go:19  "crypto/x509"
...
sdk/helper/keysutil/policy.go:44  "golang.org/x/crypto/chacha20poly1305"
sdk/helper/keysutil/policy.go:45  "golang.org/x/crypto/ed25519"
sdk/helper/keysutil/policy.go:46  "golang.org/x/crypto/hkdf"
```

There is no vendored, hand-rolled, or third-party (OpenSSL/BoringSSL-binding,
libsodium, etc.) cryptographic *implementation* imported here — every
primitive (AES-GCM, RSA, ECDSA, Ed25519, HMAC, SHA-256, ChaCha20-Poly1305,
HKDF) is either Go's own stdlib implementation or the `golang.org/x/crypto`
reference implementation that ships from the Go project. `crypto/rand` at
line 16 is the same `crypto/rand.Reader` traced in §2 below — `policy.go`
does not construct or import any alternate randomness source.

**Runtime selection (why source-code presence alone is not FIPS-CRYPTO-003
proof):** which *implementation* actually executes underneath these package
names at runtime is a Go toolchain property, not a source-code property:

- A standard `go build` (this repository's default, and the only path the CE
  release pipeline uses — `build-artifacts-ce.yml` per
  `fips/inventory/ce_fips_build_tag_verification.yaml` finding F6) links
  Go's **pure-Go** stdlib crypto implementations. These are functionally
  correct and widely used, but **not CMVP-validated** — there is no NIST
  CMVP certificate for vanilla Go stdlib crypto.
- Building the same source with `GOEXPERIMENT=boringcrypto` transparently
  swaps in cgo bindings to Google's BoringCrypto module (a CMVP-validated
  module, certs #4407/#3678 lineage) for the subset of algorithms it
  implements (AES, RSA, ECDSA, SHA-2, HMAC — notably **not** SHA-3, ChaCha20,
  or Ed25519; see Residual Gap RG-4 in `fips/crypto_inventory.yaml`). This
  requires zero source changes to `policy.go` — the same `import "crypto/aes"`
  resolves to a different implementation purely based on the build
  environment variable.
- `GOEXPERIMENT=boringcrypto` is set **only** in the enterprise-gated
  `test-go-fips` CI job (`.github/workflows/ci.yml:290`, `go-tags:
  '...,fips,fips_140_3'` at line 294), which
  `fips/inventory/ce_fips_build_tag_verification.yaml` finding F5 already
  proved is skipped on every CE run because `needs.setup.outputs.is-ent-branch`
  is hardcoded to `'false'` for any non-`vault-enterprise` repository (finding
  F4). **This repository's CE build never sets `GOEXPERIMENT=boringcrypto`
  and never receives the `fips`/`fips_140_3` build tags.**
- `go.mod:13` pins `go 1.27.1` with no `toolchain` directive to a
  FIPS-branded distribution (e.g. Microsoft's `go1.27.1-fips` build), and the
  `Makefile` contains zero references to `fips`, `boringcrypto`, or
  `GOEXPERIMENT` (`grep -in 'fips\|boringcrypto\|GOEXPERIMENT' Makefile` →
  no matches). Nothing in this repository's own build tooling requests a
  FIPS-validated toolchain.

**FIPS-CRYPTO-003 finding:** the *algorithms selected in source* are FIPS
140-3-Approved-eligible (AES, RSA, ECDSA, HMAC-SHA-256; see
`fips/crypto_inventory.yaml` for the full per-call-site approval matrix), but
the Community/OSS build's actual runtime *provider* is Go's pure-Go stdlib
implementation, which carries **no CMVP validation certificate**. See §5.

---

## 2. RNG/DRBG trace: `crypto/rand.Reader` → kernel DRBG (FIPS-CRYPTO-004)

### 2.1 The chain, as it exists in this repository

Vault does not call `crypto/rand.Reader` directly and independently at every
call site; nearly every security-relevant path is routed through a single
`io.Reader` handle so it can — in the Enterprise product — be swapped for an
entropy-augmentation source. This CE repository's implementation of that
plumbing is itself the FIPS-CRYPTO-004 evidence:

```
vault/core.go:695-696   secureRandomReader is the reader used for CSP operations
                         secureRandomReader io.Reader
vault/core.go:1129-1130 if conf.SecureRandomReader == nil {
                             conf.SecureRandomReader = rand.Reader   // crypto/rand
                         }
command/server.go:2989  SecureRandomReader: secureRandomReader,      // CoreConfig field, set from...
command/server.go:1958   secureRandomReader, err := configutil.CreateSecureRandomReaderFunc(config.SharedConfig, entropySources, entropyAugLogger)
internalshared/configutil/kms.go:38   CreateSecureRandomReaderFunc = createSecureRandomReader
internalshared/configutil/kms.go:482-484:
    func createSecureRandomReader(_ *SharedConfig, _ []*EntropySourcerInfo, _ hclog.Logger) (io.Reader, error) {
        return rand.Reader, nil   // crypto/rand.Reader, CE build — unconditional
    }
```

Every barrier/seal/cluster/token security-relevant caller reads from
`c.secureRandomReader` (or the equivalent `defaultSource`/`crand.Reader`
parameter), which — in this CE build — is **always** `crypto/rand.Reader` by
construction, not by a runtime branch that could be misconfigured:
`vault/init.go:125,292`, `vault/rekey.go:450,560,699`, `vault/raft.go:135,446,603,781`,
`vault/wrapping.go:41`, `vault/token_store.go:1139`, `vault/login_mfa.go:1178`,
`vault/logical_system.go:5519,6537`, `vault/cluster.go:229` (ECDSA cluster key)
and `vault/cluster.go:264` (`x509.CreateCertificate` using `rand.Reader`
directly). `helper/random/string_generator.go:8,88-89,189` (the generator
backing dynamic-secret credential generation) defaults its `rng io.Reader`
parameter to stdlib `crypto/rand.Reader` when the caller supplies none.

**From `crypto/rand.Reader` down to the kernel, the chain is a property of
the Go runtime and the deployment OS, not of this source tree.** As
documented by the Go project itself (`crypto/rand` package documentation,
`src/crypto/rand` in the Go toolchain — not part of this repository, so not
independently re-verifiable by grep here, but stated as the authoritative,
versioned behavior of the Go 1.27.1 toolchain this repo's `go.mod`/`.go-version`
pin):

1. **Application code** calls `crypto/rand.Reader.Read(buf)` (or a stdlib
   function that does so internally, e.g. `ecdsa.GenerateKey`,
   `x509.CreateCertificate`, `rsa.GenerateKey`).
2. On Linux, the Go runtime's `crypto/rand` implementation calls the
   `getrandom(2)` syscall directly (no `/dev/urandom` file-descriptor
   round-trip) when the kernel supports it (Linux ≥ 3.17, universally true on
   any currently-supported RHEL/UBI major version); it falls back to reading
   `/dev/urandom` only on kernels that lack `getrandom(2)`.
3. `getrandom(2)` is served by the **kernel's own CSPRNG**. On RHEL/UBI
   kernels (the deployment target implied by
   `fips/inventory/container_kms_inventory.yaml`'s `ce-ubi10-minimal` image),
   this is the kernel's SP 800-90A **CTR_DRBG** construction seeded from the
   kernel entropy pool (hardware RNG via `RDRAND`/`RDSEED` on x86_64 where
   present, jitter entropy, interrupt timing, etc., per the kernel's own
   FIPS 140-3 module boundary when the host itself runs a validated kernel
   build, e.g. RHEL's `kernel-fips` / `fips=1` boot mode).
4. **Neither Go's pure-Go stdlib crypto/rand path nor step 3's kernel DRBG is
   part of this repository's CMVP validation boundary.** Whether step 3's
   DRBG is itself operating inside a validated boundary depends entirely on
   the *host OS FIPS mode* (e.g. `fips=1` on RHEL) — a deployment-time,
   infrastructure-level setting this source tree cannot enforce, configure,
   or verify from within Vault's own code or CI.

### 2.2 Honest scope of "PASS" for this AC

Per this WO's own framing: **whether the RNG chain terminates in an
SP 800-90A-Approved, CMVP-validated DRBG is a question about the *build and
runtime environment*, not about this source code.** This source code:

- Correctly and exclusively uses `crypto/rand.Reader` (or an `io.Reader`
  that defaults to it) for every security-relevant randomness need found in
  this audit (§2.1, §3).
- Contains no logic that could route security-relevant randomness to a
  weaker source in a way this WO's own code review could catch (§3).
- Cannot, from within the CE source tree, make the underlying kernel DRBG or
  Go crypto backend CMVP-validated — that requires (a) a FIPS-mode host
  kernel and (b) `GOEXPERIMENT=boringcrypto`, both of which are outside this
  repository's CE build path today (§1, §5).

**FIPS-CRYPTO-004 disposition: PASS for "correct use of crypto/rand.Reader
in application code"; environment-dependent / NOT CMVP-validated for "the
DRBG construction crypto/rand.Reader ultimately reads from," which is
recorded as Residual Gap RG-8 in the companion inventory record (§6).**

---

## 3. No custom RNG/DRBG implementations (grep-based audit)

```
$ grep -rln "rand.Source\b" --include="*.go" vault/ sdk/ builtin/ internalshared/ helper/ | grep -v _test.go
(no matches)

$ grep -rniE "xorshift|mersenne|lcg|type.*[Dd][Rr][Bb][Gg]|type.*PRNG|CustomRand" \
    --include="*.go" vault/ sdk/ builtin/ helper/ internalshared/ | grep -v _test.go
(no matches — two apparent hits were base64-encoded PGP test-key blobs in
 internalshared/pgpkeys/test_keys.go and builtin/credential/aws/certificates.go
 that coincidentally contain the substrings "lcg"/"drbg" inside key material;
 neither is Go code implementing a random-number generator)
```

**Finding: zero custom RNG or DRBG implementations exist anywhere in
`vault/`, `sdk/`, `builtin/`, `helper/`, or `internalshared/`.** Every
randomness need in this codebase is satisfied by `crypto/rand` (security-
relevant) or `math/rand`/`math/rand/v2` (see §4 for the complete
non-security-relevant disposition of every `math/rand` call site).

---

## 4. `math/rand` audit — non-cryptographic random usage (security-relevant paths only)

`grep -rn "math/rand" vault/ sdk/ builtin/ --include="*.go" | grep -v _test.go`
returns 18 files. Every production (non-test) call site was individually
reviewed for security relevance:

| File:Line | Usage | Security-relevant? | Disposition |
|---|---|---|---|
| `vault/cluster.go:256` | `mathrand.Int63()` for the internal cluster mTLS cert's `x509.Certificate.SerialNumber` (the cert itself is signed with `rand.Reader` at line 264; the private key is generated with `c.secureRandomReader` at line 229) | Low — serial numbers are not secret and do not need CSPRNG-grade unpredictability for correctness, but RFC 5280 best practice and Go's own `x509` examples recommend `crypto/rand` for serial-number generation to avoid any collision/predictability concern | **Residual finding, not remediated by this WO** (verification-only scope). Recorded as RG-9 in §6; a future Phase 2/3 WO should swap this for `crypto/rand`-backed generation. |
| `vault/identity_store_oidc.go:1554` | `mathrand.Int63n(maxDuration)` — jitters the *scheduling interval* for periodic OIDC key rotation | No — timing jitter only, not a key/secret value. The actual key material 3 lines away (1803/1818/1822) uses `rand.Reader` | Not security-relevant; no action needed |
| `vault/logical_system.go:4431,4446,4451` | `rand.Intn`/`rand.Shuffle` build a **throwaway test password**, solely to confirm an operator-supplied password *policy* is satisfiable before saving it (`sys/policies/password`) | No — the generated string is discarded immediately after the rules check (`logical_system.go:4453-4459`) and never returned, stored, or used as a real credential. The *real* password-generation path is `helper/random/string_generator.go`, which defaults to `crypto/rand.Reader` (§2.1) | Not security-relevant; verified the real generator is crypto/rand-backed, not this validation helper |
| `vault/seal/seal_wrapper.go:115` | `mathrand.Intn(1000)` in a heartbeat test-value string (`"Heartbeat %d"`) | No — liveness-check payload, not a secret | Not security-relevant |
| `builtin/credential/cert/path_login.go:828` | `rand.Float64()` computing a ±100% jittered percentage value | No — reviewed in context; not key/secret/token generation | Not security-relevant |
| `vault/expiration.go:337`, `sdk/helper/backoff/backoff.go:102`, `sdk/physical/error.go:53`, `sdk/physical/path_error.go:51`, `sdk/physical/latency.go:57`, `builtin/logical/pki/path_tidy.go:132` | Retry backoff jitter, fault-injection test-double timing, tidy-operation scheduling delay | No — timing/scheduling only | Not security-relevant |
| `vault/identity_store_util.go:3419+`, `vault/identity_store_injector_testonly.go`, `vault/expiration_testing_util_common.go`, `vault/activity_log_testing_util.go`, `vault/identity_store_test_stubs_oss.go`, `sdk/helper/testcluster/docker/environment.go` | Test-fixture/test-helper functions (`t *testing.T` parameters, `_testonly`/`_testing_util` filenames) | No — test-only code paths | Not security-relevant |

**FIPS-CRYPTO-004-adjacent finding:** the only `math/rand` usage with any
plausible cryptographic-hygiene concern is the X.509 serial number at
`vault/cluster.go:256` (RG-9). Every other `math/rand`/`math/rand/v2` call
site in production code is timing/jitter/scheduling or a discarded
validation string, and every real key/secret/credential generation path
verified in this audit uses `crypto/rand.Reader` (directly, or via
`c.secureRandomReader`/`helper/random.StringGenerator`, both of which default
to `crypto/rand.Reader` — §2.1).

---

## 5. Entropy Augmentation disablement under FIPS mode (`command/server.go`)

```go
// command/server.go:453 (as of this WO; now factored into
// (*ServerCommand).applyFIPSEntropyOverride, see below)
if config != nil && config.Entropy != nil && config.Entropy.Mode == configutil.EntropyAugmentation && constants.IsFIPS() {
    c.UI.Warn("WARNING: Entropy Augmentation is not supported in FIPS 140-3 Inside mode; disabling from server configuration!\n")
    config.Entropy = nil
}
```

**Why this is the correct FIPS behavior:** Entropy Augmentation is an
Enterprise seal feature that mixes bytes from an external HSM/KMS device
into Vault's randomness. FIPS 140-3 Inside mode requires every consumer of
randomness to draw exclusively from the module's own validated CSPRNG
boundary (`crypto/rand.Reader` under `GOEXPERIMENT=boringcrypto`, §1) — an
externally-augmented source is, by definition, outside that boundary and
must never be silently honored. Unconditionally clearing
`config.Entropy` (with an operator-visible warning, not a silent drop) when
`constants.IsFIPS()` is true is exactly the required behavior.

**Two additional, independently-discovered layers make this guard doubly
redundant in the Community/OSS build specifically (not previously documented
in `fips/crypto_inventory.yaml`):**

1. `internalshared/configutil/config_util.go:4,18-20` — `ParseEntropy` is a
   `//go:build !enterprise` **no-op** (`return nil` without ever assigning
   `result.Entropy`). This is the *only* implementation of `ParseEntropy` in
   this CE repository (`grep -rln "func ParseEntropy" --include="*.go" .` →
   one match). An Enterprise-tagged counterpart that actually parses the
   `entropy { mode = "augmentation" }` HCL stanza lives in the closed-source
   `vault-enterprise` repository and is not present here — mirroring the
   `IsFIPS()`/`fips.go` pattern `fips/inventory/ce_fips_build_tag_verification.yaml`
   finding F3 already documented. **Practical effect: in this CE build,
   `config.Entropy` is always `nil` after `parseConfig()`, regardless of what
   an operator writes in an `entropy` stanza** — confirmed independently by
   `helper/serverconfig/config_test_helpers.go:352-390` (`testParseEntropy`),
   whose `oss` branch asserts exactly this: `if config.Entropy != nil {
   t.Fatalf("parsing Entropy should not be possible in oss...") }`.
2. `vault/core_util.go:238-248` — `GetConfigurableRNG` (the function backing
   the *separate* per-password-policy `entropy_source` config knob,
   `vault/logical_system.go:4563`) only accepts `""`/`"platform"` (both
   returning the passed-in `crypto/rand.Reader`-backed `defaultSource`
   unchanged) and returns `fmt.Errorf("unsupported entropy source: %s",
   source)` for `"seal"` — the CE stub never even reaches a branch that
   could substitute a non-`crypto/rand` source.

**Conclusion:** the `command/server.go` FIPS guard is correct and necessary
for the shared/Enterprise codebase, and in the Community/OSS build it is
reinforced by two independent structural facts (`ParseEntropy` no-op,
`GetConfigurableRNG` explicit rejection) that make an augmented entropy
source unreachable even without the guard. All three layers are now
documented together for the first time in this record.

**Testability:** `constants.IsFIPS()` is a compile-time constant selected by
the `fips` build tag (`helper/constants/fips.go` / `fips_enabled.go`), so it
cannot be mocked at runtime. This WO extracted the guard from `parseConfig()`
into `(*ServerCommand).applyFIPSEntropyOverride` (`command/server.go`) and
added `TestParseConfig_EntropyAugmentation_FIPSOverride` and
`TestParseConfig_EntropyAugmentation_FIPSOverride_NoEntropyConfigured`
(`command/server_test.go`), which call the real production method and assert
the behavior appropriate to whichever value `constants.IsFIPS()` actually has
in the binary running the test — i.e. the same test, compiled once with the
default tags and once with `-tags fips,fips_140_3`, exercises both branches
against real production code with no mocking. See §7 for why `go test` could
not be executed against this change in this sandbox.

---

## 6. Residual gap for the FIPS evidence package

**RG-8 (new, this WO): Community/OSS build has no CMVP-validated crypto
provider or DRBG boundary.**
Phase: Phase 2/3. Evidence: §1 (no `GOEXPERIMENT=boringcrypto`, no FIPS
toolchain pin, `.release/security-scan.hcl:39-41,85-87` boringcrypto-suffix
vulnerability-scanner exemptions that apply only to the Enterprise FIPS
pipeline, `.github/workflows/ci.yml:265-299` enterprise-gated
`test-go-fips` job). Description: the Community/OSS build of Vault, as
released today, executes cryptographic operations (including
`crypto/rand.Reader`) through Go's pure-Go stdlib implementation and the
host kernel's DRBG, **neither of which carries a NIST CMVP validation
certificate in this build configuration**. A CMVP-validated boundary is only
achievable via the Enterprise `GOEXPERIMENT=boringcrypto` build pipeline
(confirmed to exist, but confirmed unreachable from CE CI per WO-011) plus a
FIPS-mode-enabled host OS. This is not a code defect — it is a build/
distribution-model gap that must be tracked at the product/release level,
not fixed in application source.

**RG-9 (new, this WO): `vault/cluster.go:256` uses `math/rand` for an X.509
certificate serial number.**
Phase: Phase 2. Evidence: §4 table, row 1. Description: the internal cluster
mTLS self-signed certificate's `SerialNumber` field is populated with
`big.NewInt(mathrand.Int63())` rather than a `crypto/rand`-backed value. The
certificate's key material and signature both correctly use
`c.secureRandomReader`/`rand.Reader`; only the serial number itself uses the
non-cryptographic generator. Low severity (serial numbers are not secret),
but inconsistent with the "everything security-adjacent uses crypto/rand"
posture established everywhere else in this audit, and worth a one-line fix
in a future Phase 2 WO.

These two items, plus RG-1 through RG-7 already in `fips/crypto_inventory.yaml`,
are consolidated with full evidence references in
`fips/wo044_crypto_provider_rng_verification.yaml` (this WO's companion
structured record).

---

## 7. Environment limitation encountered while verifying this WO

This sandbox cannot resolve the private Go module
`github.com/hashicorp/releases-api@v0.4.14` (`git ls-remote` returns
"Repository not found") — the same pre-existing, out-of-scope limitation
`fips/inventory/ce_fips_build_tag_verification.yaml` already documented for
WO-011. It blocks `go build`/`go vet`/`go test` for `sdk/...` and every
package that depends on it, including `command/...` (confirmed:
`go vet ./command/...` fails with the identical `releases-api` error on
every file in the package, not just the ones this WO touched). Because of
this, the new test added in §5 could not be executed in this environment —
neither the default-tags branch nor `-tags fips,fips_140_3`. As a substitute:

- `gofmt -l command/server.go command/server_test.go` → **no output, exit 0**
  (both files parse as syntactically valid, correctly formatted Go).
- Every new symbol referenced (`testServerCommand`, `constants.IsFIPS`,
  `configutil.Entropy`/`EntropyAugmentation`, `server.Config`/`SharedConfig`
  embedding, `cli.MockUi.ErrorWriter`) was independently confirmed by reading
  its real definition in this repository (or, for `cli.MockUi`, in the
  cached `github.com/hashicorp/cli@v1.1.7` module source) rather than
  assumed.
- All grep commands in §2-§4 were executed directly against this checkout
  and their literal output is reproduced above — none of the evidence in
  this document depends on the blocked module resolution.

This should be re-run to completion (`go test -run
TestParseConfig_EntropyAugmentation ./command/...`, both with and without
`-tags fips,fips_140_3`) the moment `releases-api` resolves in a connected
environment, per the same recommendation WO-011 already recorded.
