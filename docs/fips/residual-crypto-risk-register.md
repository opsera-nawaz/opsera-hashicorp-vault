# Residual Cryptographic Operations Risk Register

**Work order:** WO-047 | **Epic:** FIPS Phase 3 — Validated Module Boundary, Container Images, and OS-Level FIPS Mode
**Quality gates:** FIPS-CRYPTO-001, FIPS-CRYPTO-002, FIPS-CRYPTO-005 (see "Quality gate ID note" below for FIPS-CRYPTO-003/004)
**Document version:** 1.0.0
**Generated:** 2026-09-27
**Last verified:** 2026-09-27

## Disclaimer

This register documents Vault Community Edition's **FIPS-aligned posture** for
cryptographic operations that execute outside any validated cryptographic
module boundary. It does **not** claim, and must never be read as claiming,
that Vault or any of the mechanisms below is "FIPS validated," "FIPS
certified," or "FIPS compliant." Validation/certification is a CMVP
determination about a specific module boundary and build, not a
self-assessment. Every finding below is dated and tied to a specific file and
line reference so it can be re-verified as the codebase changes.

## Purpose and scope

This is the consolidated, version-controlled risk register required by the
FIPS Phase 3 exit criterion that residual cryptographic operations outside
the validated module boundary are **explicitly documented with risk
assessment**, not omitted. It aggregates:

- The Shamir non-KMS-seal finding first raised in
  [`docs/fips/kms-hsm-seal-cmvp-certificates.md`](kms-hsm-seal-cmvp-certificates.md)
  §(a) (WO-030), which explicitly forward-referenced this document as `RR-001`.
- The key/seal hierarchy and `crypto/rand`-entropy findings in
  [`docs/fips/key-management-assessment.md`](key-management-assessment.md)
  §(b)-(d) (WO-031).
- The `residual_gaps` entries `RG-2`, `RG-3`, and `RG-5` in
  [`fips/crypto_inventory.yaml`](../../fips/crypto_inventory.yaml) (WO-019,
  Phase 1 capstone).
- Two findings not previously captured in any landed artifact, produced by
  the direct code analysis this WO's implementation steps require: PGP share
  encryption in `vault/rekey.go` (RR-002) and the default cluster (port 8201)
  TLS cipher-suite list in `vault/core.go` (RR-005).

**Out of scope** (per this WO's own acceptance criteria): remediating any
finding (remediation requires architectural changes beyond this epic), the
KMS/HSM CMVP certificate documentation (that is WO-030's deliverable, cited
here only as a companion artifact), and any source-code change — this story
modifies documentation only.

## Disposition legend

| Disposition | Meaning |
|---|---|
| **accepted** | The residual operation is structurally required by Vault's current architecture (e.g. the default unseal path, a Go-stdlib-underpinned engine) and is accepted as a residual risk with a compensating control, pending an architectural change that is out of this epic's scope. |
| **mitigated** | A compensating control already reduces the risk to an acceptable level for FIPS-aligned deployments (e.g. an alternative Approved-algorithm path exists and is documented as the recommended configuration). |
| **remediation-planned** | A Phase 2/3/4 work item already exists to close the gap; not used for any finding in this register — no finding here has an active remediation WO at the time of writing. |

## Risk register entries

### RR-001 — Shamir's Secret Sharing (default manual-unseal mechanism)

| Field | Value |
|---|---|
| Finding ID | RR-001 |
| Affected file(s) | `vault/shamir/shamir.go` (algorithm implementation); `vault/rekey.go:403,466` (barrier rekey: `shamir.Combine`, `shamir.Split`); `vault/rekey.go:685,714` (recovery rekey: `shamir.Combine`, `shamir.Split`); `vault/rekey.go:899` (rekey verification: `shamir.Combine`); `vault/core.go:1328-1336` (default seal: `if c.seal == nil { wrapper := aeadwrapper.NewShamirWrapper(); ...; c.seal = NewDefaultSeal(access) }` — the implicit default when no `seal` stanza is configured); `vault/core.go:2139` (initial unseal: `shamir.Combine`) |
| Algorithm/operation | Shamir's Secret Sharing (threshold polynomial secret splitting/combining) applied to the barrier root key and the recovery key. Share generation and the Lagrange-interpolation combine step run in-process, outside any validated cryptographic module boundary. |
| Risk level | Medium |
| Disposition | **accepted residual risk** |
| Compensating control | Recommend KMS auto-unseal for FIPS-path production deployments. |
| Cross-references | `fips/crypto_inventory.yaml` `residual_gaps` `RG-5`; quality gates FIPS-CRYPTO-001 (module boundary mapping — `fips/inventory/core_barrier_seal_crypto_sites.yaml` header) and FIPS-CRYPTO-005 (key management evaluation); companion evidence: `docs/fips/kms-hsm-seal-cmvp-certificates.md` §(a) (WO-030, the document that first forward-referenced this entry as `RR-001`) and `docs/fips/key-management-assessment.md` §(c) key hierarchy (WO-031) |

Shamir is not on the NIST SP 800-140C/D Approved mechanism list and does not
appear in any validated CMVP module boundary. It is structurally required as
the zero-configuration default (`vault/core.go:1328-1336` runs whenever no
`seal` stanza is present) and remains the only unseal mechanism that requires
no external dependency, so it cannot be removed without breaking Vault's
out-of-the-box unseal flow — an architectural change outside this epic's
scope. The compensating control is operational, not code-level: operators
targeting a FIPS-aligned posture must explicitly configure one of the KMS
auto-unseal providers documented in `docs/fips/kms-hsm-seal-cmvp-certificates.md`
(AWS KMS, Azure Key Vault, or GCP Cloud KMS) instead of leaving the seal
stanza absent.

### RR-002 — PGP share encryption in rekey flows

| Field | Value |
|---|---|
| Finding ID | RR-002 |
| Affected file(s) | `vault/rekey.go:481` (`results.PGPFingerprints, results.SecretShares, err = pgpkeys.EncryptShares(hexEncodedShares, c.barrierRekeyConfig.PGPKeys)` — barrier rekey); `vault/rekey.go:727` (identical call against `c.recoveryRekeyConfig.PGPKeys` — recovery rekey); `internalshared/pgpkeys/encrypt_decrypt.go:21-50` (`EncryptShares` implementation, calls `openpgp.Encrypt` at line 32) |
| Algorithm/operation | OpenPGP public-key encryption of Shamir key shares, via `github.com/ProtonMail/go-crypto/openpgp` (`go.mod:49`, `v1.4.0`), used only when an operator supplies `pgp_keys` on a rekey request for out-of-band secure distribution of shares to key holders. The symmetric/asymmetric algorithm actually negotiated (e.g. AES vs. a legacy OpenPGP cipher) is determined by each recipient's PGP key preferences, not by any Vault-side allowlist — `EncryptShares` passes `nil` for algorithm preferences to `openpgp.Encrypt` (`encrypt_decrypt.go:32`), so Vault does not constrain the negotiated cipher. |
| Risk level | Medium |
| Disposition | **accepted residual risk** |
| Compensating control | For FIPS-path deployments, do not supply `pgp_keys` on `sys/rekey/*` or `sys/rekey-recovery-key/*` requests; distribute unseal/recovery material out-of-band through a process that does not depend on an unvalidated OpenPGP implementation. Where KMS auto-unseal (RR-001's compensating control) is in effect, there are no Shamir shares to distribute at all, which also eliminates this exposure. |
| Cross-references | Not previously present in `fips/crypto_inventory.yaml`'s `residual_gaps` list (`RG-1`..`RG-7`) — first documented here from direct analysis of `vault/rekey.go` per this WO's implementation steps. Downstream of `RG-5` (Shamir) since it only ever encrypts material that is itself already outside the validated boundary. Quality gates FIPS-CRYPTO-001 (module boundary) and FIPS-CRYPTO-005 (key management evaluation) |

This is a new finding, not a restatement of an existing `RG-x` entry: the
Phase 1 inventory (`fips/crypto_inventory.yaml`) catalogs `shamir.Split`/
`shamir.Combine` under `RG-5` but does not separately track the PGP
share-encryption step that both `BarrierRekeyUpdate` (`rekey.go:322-541`) and
`RecoveryRekeyUpdate` (`rekey.go:612-787`) perform when `PGPKeys` is
non-empty. The risk is bounded — it is an optional, operator-invoked code
path exercised only during a rekey operation, not a hot path — but it is a
second, independent non-validated cryptographic operation in the same
workflow as RR-001 and is recorded separately so the register does not
silently fold it into the Shamir finding.

### RR-003 — Go stdlib crypto operations in `sdk/helper/keysutil/policy.go` outside a validated module boundary

| Field | Value |
|---|---|
| Finding ID | RR-003 |
| Affected file(s) | `sdk/helper/keysutil/policy.go:10` (`crypto/aes`), `:12` (`crypto/ecdsa`), `:15` (`crypto/hmac`), `:17` (`crypto/rsa`), `:18` (`crypto/sha256`) — the full stdlib import block is lines 9-19. Representative call sites: AES-GCM/AES-CBC/AES-CMAC dispatch (`policy.go:2067,2312-2313` family), `generateECDSAKey` (`policy.go:3112-3125` per WO-031 Finding G1), RSA key generation via `cryptoutil.GenerateRSAKey` (`policy.go:2054-2068`), HMAC key handling, SHA-256 KDF hashing (`policy.go:1111`, `hkdf.New(sha256.New, ...)`) |
| Algorithm/operation | AES-GCM/AES-CBC/AES-CMAC (symmetric), ECDSA on NIST P-256/P-384/P-521 (asymmetric signing), RSA-2048/3072/4096 (asymmetric), HMAC-SHA256, SHA-256 — every one of these is individually on the FIPS-Approved algorithm list, but executed via Go's pure-Go stdlib `crypto/*` implementations, which are not themselves a CMVP-validated cryptographic module. |
| Risk level | Low |
| Disposition | **accepted residual risk** |
| Compensating control | None required at the algorithm level (all five primitives are Approved). The only path that would move these operations inside a validated module boundary is enabling Go's BoringCrypto experiment (`GOEXPERIMENT=boringcrypto`) or delegating key operations to a validated external KMS/HSM (out of scope for this WO — see WO-030). Neither is active for Vault Community Edition builds today (see note below). |
| Cross-references | Quality gates FIPS-CRYPTO-001 (`fips/inventory/keysutil_policy_crypto_sites.yaml` header: "Epic: FIPS Phase 1 — Cryptographic Inventory and Discovery (FIPS-CRYPTO-001)") and FIPS-CRYPTO-005 (key management evaluation — these are the same generation/rotation call sites `docs/fips/key-management-assessment.md` §(b)-(d) traces to `crypto/rand.Reader`) |

**BoringCrypto vs. OpenSSL FIPS provider architecture divergence.** This
repository has two structurally distinct, non-overlapping mechanisms that
*could* move Go-stdlib crypto calls inside a validated boundary, and CE uses
neither by default:

1. **BoringCrypto** (`GOEXPERIMENT=boringcrypto`) replaces Go's pure-Go
   `crypto/*` implementations with cgo calls into BoringSSL at the language
   runtime level. `fips/crypto_inventory.yaml:5190-5195` confirms this via a
   repo-wide grep: the only hardcoded `GOEXPERIMENT=boringcrypto` literal is
   in an **enterprise-gated** CI job (`test-go-fips`, default
   `goexperiment: ""` — `.github/actions/build-vault/action.yml:126,139`),
   and `verification_result: PASS — CE builds never apply fips or
   boringcrypto build tags`.
2. **OpenSSL FIPS provider at the OS/container level** — the architecture
   artifact's ADR-004 (container base image) targets UBI 9 (glibc) precisely
   because Red Hat maintains FIPS-validated OpenSSL packages at the
   operating-system layer, replacing Alpine/musl for FIPS-path deployments.
   This is an OS-level control, not a Go-runtime control, and it does not by
   itself change which crypto implementation `sdk/helper/keysutil/policy.go`'s
   pure-Go `crypto/*` calls execute against unless the Go binary is also
   built to link against the platform's OpenSSL (which CE does not do today).

Because CE enables neither path, every stdlib call in `policy.go` today runs
Go's pure-Go implementation — Approved algorithm, unvalidated module. Closing
this gap (adopting BoringCrypto, or an OpenSSL-linked Go crypto backend) is
an architectural decision beyond this WO's scope and is not recommended or
scheduled here; it is recorded so the divergence between the two candidate
mechanisms is not conflated in future evidence packages.

### RR-004 — `golang.org/x/crypto` non-Approved algorithms in `sdk/helper/keysutil/policy.go`

| Field | Value |
|---|---|
| Finding ID | RR-004 |
| Affected file(s) | `sdk/helper/keysutil/policy.go:47` (`golang.org/x/crypto/chacha20poly1305`), `:48` (`golang.org/x/crypto/ed25519`), `:49` (`golang.org/x/crypto/hkdf`). Call sites: `chacha20poly1305.New` (`policy.go:2313,2393`), `ed25519.GenerateKey` (`policy.go:2163`; also `generateEd25519Key`, per `docs/fips/key-management-assessment.md` §(b) at `policy.go:2104-2120`), `hkdf.New(sha256.New, ...)` (`policy.go:1111`). `KeyType_ChaCha20_Poly1305` is declared at `policy.go:69`; `KeyType_ED25519` at `policy.go:66`. |
| Algorithm/operation | ChaCha20-Poly1305 AEAD (`KeyType_ChaCha20_Poly1305`) and Ed25519 signing (`KeyType_ED25519`) are **not** on the FIPS-Approved list (ChaCha20-Poly1305 is not an SP 800-38-series Approved AEAD mode; Ed25519 is not a FIPS 186-5 Approved signature curve). HKDF-SHA256 (`Kdf_hkdf_sha256`) **is** Approved — it is a SHA-256-based KDF construction, included in this entry only because it shares the same import (`golang.org/x/crypto/hkdf`), not because it is itself a non-Approved algorithm. |
| Risk level | High |
| Disposition | **accepted residual risk** (Phase 2 algorithm migration status: not yet remediated — see below) |
| Compensating control | Do not select `chacha20poly1305`/`ed25519` as the `type` parameter when creating new Transit keys on a FIPS-aligned deployment; use `aes256-gcm96` and `ecdsa-p256`/`ecdsa-p384`/`ecdsa-p521` instead. Per the architecture artifact's ADR-003, a FIPS build tag can make these two `KeyType`s unavailable for **new** key creation, but existing keys of these types remain readable (no forced migration) — operators must audit existing Transit key inventories separately. |
| Cross-references | `fips/crypto_inventory.yaml` `residual_gaps` `RG-2` (ChaCha20-Poly1305) and `RG-3` (Ed25519); quality gate **FIPS-CRYPTO-002** — the algorithm-allowlist enforcement gate, declared in both `.golangci.yml:20-36` (`depguard` rule `fips-crypto-restrictions`, denying exactly these two `golang.org/x/crypto` imports on `**/sdk/helper/keysutil/**`, `**/vault/**`, `**/builtin/logical/**`) and `tools/semgrep/ci/fips-crypto-imports.yml` (same two packages, `severity: ERROR`) |

**Phase 2 migration status: not complete, and the enforcement mechanism has
a gap.** `RG-2` and `RG-3` are both tagged `phase: Phase 2` in
`fips/crypto_inventory.yaml`, meaning the Phase 2 (Approved Algorithms)
initiative has not removed either `KeyType` from the CE-selectable set —
they remain fully selectable today via the Transit engine, and per
`fips/inventory/builtin_logical_crypto_sites.yaml`, Ed25519 is also
selectable as a `key_type` in PKI CA/CSR issuance, database
client-certificate auth, and the SSH secrets engine's CA key type
(`pki/path_root.go:773-828`, `database/credentials.go:303-381`,
`ssh/path_config_ca.go:356-455`).

Separately, the **declared enforcement policy for FIPS-CRYPTO-002 does not
currently gate this file**: `sdk/helper/keysutil/policy.go` imports both
`golang.org/x/crypto/chacha20poly1305` and `golang.org/x/crypto/ed25519`
directly inside the path (`**/sdk/helper/keysutil/**`) that the `.golangci.yml`
`fips-crypto-restrictions` `depguard` rule and the `tools/semgrep/ci/fips-crypto-imports.yml`
rule both name as in-scope and denied, and the file is not covered by either
rule's test-file/`vault/testing.go` exclusions. Neither rule is currently
wired into a GitHub Actions workflow — `golangci-lint` (which reads
`.golangci.yml`) is only invoked from the root `Makefile`'s `lint`/`ci-lint`
targets (`Makefile:158-169`), and no `.github/workflows/*.yml` job calls
`make lint`, `make ci-lint`, or `golangci-lint` directly (the one workflow
that runs `make lint`, `.github/workflows/enos-lint.yml:72`, does so with
`working-directory: ./enos`, which resolves to `enos/Makefile`'s own `lint`
target — Terraform/shell formatting checks, unrelated to Go source or
`golangci-lint`). The `fips-crypto-imports.yml` semgrep rule is likewise not
referenced by any workflow. This means the FIPS-CRYPTO-002 gate exists as
declared policy-as-code but would fail against `policy.go` if it were
enabled today, and this gap between declared policy and CI enforcement is
itself part of what this entry documents — closing it (wiring the gate into
CI, and either removing the two imports or carving out an explicit
documented exception for the Transit/PKI/SSH/database call sites that must
keep them for backward compatibility) is a Phase 4 (Evidence & CI) action
item, not something this WO remediates.

### RR-005 — ChaCha20-Poly1305 in the default cluster (port 8201) TLS cipher suite

| Field | Value |
|---|---|
| Finding ID | RR-005 |
| Affected file(s) | `vault/core.go:1292-1310` (`switch conf.ClusterCipherSuites { case "": c.clusterCipherSuites = []uint16{ tls.TLS_AES_128_GCM_SHA256, tls.TLS_AES_256_GCM_SHA384, tls.TLS_CHACHA20_POLY1305_SHA256, tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256, tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384, tls.TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305, } }`) |
| Algorithm/operation | `TLS_CHACHA20_POLY1305_SHA256` (TLS 1.3) and `TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305` (TLS 1.2) are included in Vault's **default** cluster-communication (port 8201, inter-node Raft/HA replication) cipher-suite list whenever `cluster_cipher_suites` is left unset in the listener config (the `case ""` branch). ChaCha20-Poly1305 is not a FIPS-Approved AEAD; the other four suites in the same default list (AES-GCM variants) are Approved. |
| Risk level | High |
| Disposition | **accepted residual risk** |
| Compensating control | Set `cluster_cipher_suites` explicitly in the listener stanza to an AES-GCM-only allowlist (e.g. `TLS_AES_128_GCM_SHA256,TLS_AES_256_GCM_SHA384,TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384`) for any FIPS-aligned deployment; this is parsed via `tlsutil.ParseCiphers` in the `default:` branch of the same `switch` (`core.go:1311`), so the override mechanism already exists in the current codebase — this is a configuration recommendation, not a code change. |
| Cross-references | `fips/crypto_inventory.yaml` `residual_gaps` `RG-2` (explicitly lists `vault/core.go:1292-1315 default cluster cipher suites` and `fips/inventory/tls_listener_config.yaml#cluster-cipher-suites` as evidence); quality gate FIPS-CRYPTO-002 (same Approved-algorithm-allowlist gate as RR-004; also related to `FIPS-TLS-001`, the client-listener TLS requirement in `fips/inventory/tls_listener_config.yaml:3`, though that gate's stated scope is the client API listener, not cluster communication) |

This entry exists separately from RR-004 because it is a **default
configuration value**, not a library import — the risk is that an operator
who never sets `cluster_cipher_suites` inherits a non-Approved cipher suite
on the inter-node replication channel without any explicit choice, whereas
RR-004 concerns algorithms an operator must actively select (a Transit
`KeyType` or a PKI `key_type`). Both trace back to the same `RG-2` inventory
entry and the same FIPS-CRYPTO-002 gate, but the compensating control differs
(a listener config override here, vs. Approved-algorithm key-type selection
for RR-004), so they are tracked as distinct findings.

## Quality gate ID note (FIPS-CRYPTO-003 / FIPS-CRYPTO-004)

This register's acceptance criteria call for cross-referencing
"FIPS-CRYPTO-002 through FIPS-CRYPTO-005." A repository-wide search
(`grep -rn "FIPS-CRYPTO-00[1-9]"`) confirms that **FIPS-CRYPTO-001**
(cryptographic module identification — `fips/crypto_inventory.yaml:5552`),
**FIPS-CRYPTO-002** (Approved-algorithm allowlist enforcement — `.golangci.yml:29`,
`tools/semgrep/ci/fips-crypto-imports.yml:4`), and **FIPS-CRYPTO-005** (key
management evaluation — `docs/fips/key-management-assessment.md:1`,
`docs/fips/kms-hsm-seal-cmvp-certificates.md:4`) are the only three of that
range with any defining artifact in this repository as of the "last
verified" date above. **FIPS-CRYPTO-003 and FIPS-CRYPTO-004 do not appear
anywhere in this repository** — no quality-gate definition, CI check, or
inventory entry references either ID. This register cites the range exactly
as specified in its acceptance criteria but does not invent scope or
evidence for the two unassigned IDs; a future WO that formally defines
FIPS-CRYPTO-003/004 should update this register's cross-references
accordingly.

## Traceability: full `residual_gaps` (RG-1..RG-7) disposition

| RG ID | Title | Disposition in this register |
|---|---|---|
| RG-1 | TLS 1.0/1.1 remain configurable on the client API listener | Not in scope for this WO (client-listener TLS floor, not a residual crypto **operation**) — tracked under `FIPS-TLS-001` / `fips/inventory/tls_listener_config.yaml`, owned outside this epic's WO-047 boundary |
| RG-2 | ChaCha20-Poly1305 is exercised on security-relevant paths | Mapped to **RR-004** (Transit/policy.go import) and **RR-005** (cluster cipher suite default) |
| RG-3 | Ed25519 is exercised on security-relevant paths | Mapped to **RR-004** |
| RG-4 | SHA-3 is excluded from the FIPS-validated boundary under boringcrypto builds | Not in scope for this WO (a hash-function selectability gap under a build mode CE does not use, distinct from the "operations outside the validated boundary" findings this register catalogs) — remains tracked solely in `fips/crypto_inventory.yaml` |
| RG-5 | Shamir's Secret Sharing is not a FIPS-Approved mechanism | Mapped to **RR-001** |
| RG-6 | CMVP certificates for configured KMS/HSM backends are not tracked in-repo | Explicitly out of scope for WO-047 per its own description ("does not cover KMS/HSM integrations") — owned by WO-030 (`docs/fips/kms-hsm-seal-cmvp-certificates.md`) |
| RG-7 | Duplicate go-jose and golang-jwt major-version dependencies | Not in scope for this WO (a dependency-hygiene/consolidation finding, not a cryptographic operation outside the validated boundary) — remains tracked solely in `fips/crypto_inventory.yaml` |

RR-002 and RR-005 are recorded above for a finding not present in
`fips/crypto_inventory.yaml`'s `residual_gaps` list; RG-1, RG-4, RG-6, and
RG-7 are unaffected by this register and remain owned by the artifacts
already tracking them, cited here only for completeness of the aggregation
this WO performs.

## Summary — overall residual risk posture

Vault Community Edition's cryptographic surface has five identified
categories of operation that execute outside any validated FIPS 140-3
cryptographic module boundary: the default Shamir manual-unseal mechanism
and its PGP share-encryption option (RR-001, RR-002); Go-stdlib-implemented
Approved algorithms in the Transit key-management path (RR-003); two
non-Approved algorithms selectable in that same path and in PKI/database/SSH
issuance (RR-004); and a non-Approved cipher suite in the default
inter-node cluster TLS configuration (RR-005). None of these five findings
has an in-repo remediation planned as of this document's "last verified"
date — each is either structurally required by the current architecture
(RR-001, RR-003) or requires an explicit, already-available configuration
choice by the operator to avoid (RR-002, RR-004, RR-005). Taken together,
they represent Vault's residual gap between "Approved algorithms are used
and documented" and "every cryptographic operation executes inside a
CMVP-validated module" — the latter is achieved only for the operations
that are explicitly delegated to a validated external KMS/HSM boundary, as
documented in the companion artifact `docs/fips/kms-hsm-seal-cmvp-certificates.md`
(WO-030). This register, together with that document and
`docs/fips/key-management-assessment.md` (WO-031), gives auditors and
compliance stakeholders a complete, dated, cross-referenced picture of
Vault's FIPS-aligned posture: what is Approved, what is delegated to a
validated boundary, and — the purpose of this specific artifact — what
remains outside that boundary and why.

## Change history

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-09-27 | Initial publication (WO-047): RR-001 through RR-005 established; full `RG-1`..`RG-7` traceability recorded. |
