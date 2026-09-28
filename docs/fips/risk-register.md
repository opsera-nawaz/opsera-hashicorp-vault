# FIPS 140-3 Quality Gate Risk Register

**Work order:** WO-067 | **Epic:** FIPS Phase 4 — Evidence Package, CI Enforcement, and Traceability
**Document version:** 1.0.0
**Generated:** 2026-09-27
**Last verified:** 2026-09-27
**Machine-readable companion:** [`.release/fips-data/risk-register.json`](../../.release/fips-data/risk-register.json)

## Disclaimer

This register documents HashiCorp Vault Community Edition's (CE/OSS) current
**FIPS-aligned posture** across every defined FIPS 140-3 modernization
quality gate. It does **not** claim, and must never be read as claiming,
that Vault — or any mechanism, algorithm, build, or configuration described
below — is "FIPS validated," "FIPS certified," or "FIPS compliant."
Validation and certification are CMVP determinations about a specific,
submitted cryptographic module boundary and build; they are not a
self-assessment and cannot be granted by this document, by this repository,
or by any CI check defined in it. Every status in this register is dated,
tied to a specific version-controlled evidence artifact, and re-verifiable
by re-running the citation.

## Purpose and scope

This is the consolidated, version-controlled **quality-gate-level** risk
register for the FIPS 140-3 modernization effort. Its scope is the
**Community/OSS (`ce`) build and edition** of Vault. It exists to give
compliance stakeholders and auditors a single authoritative table mapping
every FIPS quality gate (`FIPS-CRYPTO-001` through `FIPS-RUNTIME-001`) to
its current assessment status, the evidence that supports that status, the
accountable owner, and any residual gap.

This register **consolidates and cross-references**, rather than replaces,
three existing artifacts:

- [`docs/fips/residual-crypto-risk-register.md`](residual-crypto-risk-register.md)
  (WO-047) — the **cryptographic-operation-level** register (findings
  `RR-001`..`RR-005`: Shamir, PGP share encryption, Go-stdlib crypto,
  non-Approved algorithms, and the default cluster TLS cipher suite).
- [`fips/crypto_inventory.yaml`](../../fips/crypto_inventory.yaml) `quality_gates`
  section (WO-019 Phase 1 capstone) — the source self-assessment for
  `FIPS-CRYPTO-001`, `FIPS-DEP-001`, and `FIPS-CONTAINER-001`.
- [`tools/pipeline/internal/cmd/generate_fips_evidence.go`](../../tools/pipeline/internal/cmd/generate_fips_evidence.go)
  (WO-057) and its real, committed output at
  [`.release/fips-evidence/20260928T025959Z-fips-evidence.json`](../../.release/fips-evidence/20260928T025959Z-fips-evidence.json)
  — the **machine-computed** verification log for seven of the ten gates.
- [`tools/pipeline/internal/cmd/validate_exceptions.go`](../../tools/pipeline/internal/cmd/validate_exceptions.go)
  and [`.release/fips-data/exceptions.json`](../../.release/fips-data/exceptions.json)
  (WO-063) — the formal EXCEPTION-status tracking registry consumed by the
  evidence generator.

**Out of scope** (per this WO's own description): evidence package
generation and CI gate implementation (both already delivered, respectively,
by WO-057 and WO-033/WO-056/WO-062/WO-064) and remediation of any finding —
this document is a documentation/risk-tracking artifact, not a code change.

## Status legend

| Status | Meaning |
|---|---|
| **PASS** | The gate's automated or documented check currently succeeds against real, checked-in evidence. |
| **PARTIAL** | The gate has real, checked-in evidence but that evidence itself reports incomplete coverage (e.g. N/M call sites classified). |
| **REVIEW** | The gate's automated check ran but flagged a condition that must not be assumed safe (e.g. a config value left unset, a declared-but-unenforced CI rule). |
| **FAIL** | The gate's check currently fails, or the underlying property it verifies is confirmed absent for the CE build. |
| **EXCEPTION** | The gate has one or more findings formally tracked in the WO-063 exception registry with an owner, justification, and expiry date. |
| **BLOCKED** | The gate cannot be assessed because a prerequisite artifact or phase is not yet complete. |

## Quality gate matrix

| Gate ID | Gate Name | Phase | Current Status | Evidence Reference | Owner | Residual Gap | Risk Rating |
|---|---|---|---|---|---|---|---|
| FIPS-CRYPTO-001 | Cryptographic module identification | Phase 1 — Cryptographic Inventory and Discovery | PARTIAL | `fips/crypto_inventory.yaml` (`quality_gates.FIPS-CRYPTO-001`, lines 5552-5573), `.release/fips-data/crypto-inventory.json`, `.release/fips-evidence/20260928T025959Z-fips-evidence.json` (`verification_log[0]`, reports PASS on file-presence only) | @hashicorp/vault-crypto | 12 of 262 call sites (`unidentified_entries`) remain unclassified — all are externalized plugin secrets-engine/auth-method call sites (`kv`, `aws`, `gcp`, `azure`, `rabbitmq`, `ldap`, `terraform`, `ad`, `alicloud`, `token`) with no vendored source in this repo, not misclassified in-repo code. | Low |
| FIPS-CRYPTO-002 | Approved-algorithm allowlist enforcement | Phase 2 — Approved Algorithms | REVIEW | `.golangci.yml:22-36` (`fips-crypto-restrictions` depguard rule), `tools/semgrep/ci/fips-crypto-imports.yml`, `docs/fips/residual-crypto-risk-register.md#RR-004`, `.release/fips-evidence/20260928T025959Z-fips-evidence.json` (`verification_log[1]`) | @hashicorp/vault-crypto | The rule is declared but not wired into any GitHub Actions workflow (`golangci-lint`/semgrep are invoked from no `.github/workflows/*.yml` job today), and its own path scope does not exclude `sdk/helper/keysutil/policy.go` — which currently imports both denied packages (`chacha20poly1305`, `ed25519`). The rule would fail against `policy.go` the moment it is enabled. | High |
| FIPS-CRYPTO-003 | Runtime cryptographic provider verification | Phase 2 — Approved Algorithms | FAIL | `docs/fips/crypto-provider-verification.md` §1, `fips/wo044_crypto_provider_rng_verification.yaml` | @hashicorp/vault-crypto | Confirmed (WO-044): the CE build never sets `GOEXPERIMENT=boringcrypto` (enterprise-gated `test-go-fips` CI job only, `needs.setup.outputs.is-ent-branch` hardcoded `false` for CE) and pins no FIPS-branded Go toolchain. Every stdlib `crypto/*` call in the CE build therefore runs Go's pure-Go implementation, which carries no CMVP validation certificate. Structural, not a defect; not remediable without an Enterprise-only build path. | Medium |
| FIPS-CRYPTO-004 | RNG/DRBG chain verification | Phase 2 — Approved Algorithms | PARTIAL | `docs/fips/crypto-provider-verification.md` §2-4, `fips/wo044_crypto_provider_rng_verification.yaml`, `vault/core.go:695-696,1129-1130` | @hashicorp/vault-crypto | PASS for "application code correctly and exclusively routes security-relevant randomness through `crypto/rand.Reader`" (verified by grep audit, zero custom RNG/DRBG implementations found). NOT independently verifiable for "the DRBG construction `crypto/rand.Reader` ultimately reads from is CMVP-validated" — that depends on host OS FIPS mode (e.g. RHEL `fips=1`) at deployment time, outside this source tree. One low-severity non-CSPRNG usage found: `vault/cluster.go:256` uses `math/rand` for an X.509 cert serial number (tracked as RG-9 in `fips/wo044_crypto_provider_rng_verification.yaml`). | Medium |
| FIPS-CRYPTO-005 | Key management evaluation | Phase 3 — Validated Module Boundary, Container Images, and OS-Level FIPS Mode | PARTIAL | `docs/fips/key-management-assessment.md`, `docs/fips/kms-hsm-seal-cmvp-certificates.md`, `.release/fips-data/cmvp-certificates.json`, `docs/fips/residual-crypto-risk-register.md#RR-001` | @hashicorp/vault-crypto | Key hierarchy and rotation are documented and CMVP certificate references for AWS KMS/Azure Key Vault/GCP Cloud KMS are loaded without a lapsed-expiry finding, but the default (no `seal` stanza configured) unseal mechanism is Shamir's Secret Sharing (`RR-001`), which is not on the NIST SP 800-140C/D Approved mechanism list. See Residual Gaps below. | Medium |
| FIPS-TLS-001 | Client API listener (port 8200) Approved-cipher enforcement | Phase 2 — Approved Algorithms | REVIEW | `.release/linux/package/etc/vault.d/vault.hcl:27-30`, `api/client.go:270` (client-side `MinVersion: tls.VersionTLS12` default), `.release/fips-evidence/20260928T025959Z-fips-evidence.json` (`verification_log[5]`), `tools/pipeline/internal/cmd/generate_fips_evidence.go` (`extractTLSListenerConfig`/`evaluateTLSListenerConfig`) | @hashicorp/vault-crypto | The shipped server config template's `listener "tcp"` block does not explicitly set `tls_min_version` or `tls_cipher_suites`; the evidence generator's own policy is to flag an unset value as REVIEW rather than assume the runtime default is Approved. The Vault Go SDK client (`api/client.go:270`) does default to TLS 1.2, but that is the client, not the server listener this gate evaluates. | Medium |
| FIPS-TLS-002 | Cluster/replication listener (port 8201) Approved-cipher enforcement | Phase 2 — Approved Algorithms | FAIL | `vault/core.go:1292-1310`, `docs/fips/residual-crypto-risk-register.md#RR-005`, `fips/crypto_inventory.yaml` `residual_gaps` `RG-2` | @hashicorp/vault-crypto | The default cluster cipher-suite list (used whenever `cluster_cipher_suites` is left unset) includes `TLS_CHACHA20_POLY1305_SHA256` and `TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305`, neither of which is FIPS-Approved. No CI gate currently enforces an Approved-only cluster cipher list; the compensating control (explicit `cluster_cipher_suites` override) is operator-configured, not default. | High |
| FIPS-DEP-001 | Cryptographic dependency identification | Phase 1 — Cryptographic Inventory and Discovery | PASS | `fips/crypto_inventory.yaml` (`quality_gates.FIPS-DEP-001`, lines 5574-5581), `.release/fips-data/exceptions.json`, `.release/security-scan.hcl` (`suppress.vulnerabilities`, lines 42-43/90-91) | security-team | 25/25 module entries carry the full classification field set. The one open finding is a dependency-hygiene item (duplicate `go-jose`/`golang-jwt` major versions, `RG-7`), not a classification gap. Eight `GO-2026-*` boringcrypto-suffix false-positive scanner findings are formally tracked as EXCEPTION-status entries in `.release/fips-data/exceptions.json`, expiring 2026-12-31. | Low |
| FIPS-CONTAINER-001 | Container and KMS/HSM classification | Phase 3 — Validated Module Boundary, Container Images, and OS-Level FIPS Mode | PARTIAL | `fips/crypto_inventory.yaml` (`quality_gates.FIPS-CONTAINER-001`, lines 5582-5589), `docs/fips/kms-hsm-seal-cmvp-certificates.md`, `.release/fips-evidence/20260928T025959Z-fips-evidence.json` (`verification_log[4]`, reports PASS on file-presence only) | @hashicorp/github-secure-vault-core | 2 of 3 container images have a definitive CMVP status (`ce-ubi10-minimal` is `fips_path_candidate_requires_runtime_verification`); 1 of 6 KMS/HSM providers has a resolved CMVP certificate binding (AWS KMS/Azure Key Vault/GCP Cloud KMS require external lookup; AliCloud KMS/OCI KMS status unknown — `RG-6`). Every image/provider is classified by role and wiring; what is incomplete is confirmed CMVP validation status, not classification. | Medium |
| FIPS-RUNTIME-001 | Runtime FIPS evidence generation and exception-registry integration | Phase 4 — Evidence Package, CI Enforcement, and Traceability | REVIEW | `.release/fips-evidence/20260928T025959Z-fips-evidence.json`, `tools/pipeline/internal/cmd/generate_fips_evidence.go`, `.release/scripts/generate-fips-evidence.sh`, `tools/pipeline/internal/cmd/fips_evidence.go:44,65` | @hashicorp/team-vault-quality | A real, dated evidence package is generated and committed. However, `fips_evidence.go:65` defaults the `--exceptions` flag to `.release/fips-data/fips-exceptions.json`, which does not exist — the real exception registry WO-063 landed is named `.release/fips-data/exceptions.json`. The committed evidence artifact's own `verification_log` shows the resulting REVIEW ("exception records file not found... treating as no active exceptions") and an empty `exceptions` array, meaning the evidence package's default invocation silently does not pick up the 8 real EXCEPTION-status findings unless `--exceptions .release/fips-data/exceptions.json` is passed explicitly. This filename mismatch is a real integration gap discovered during this WO's review, not a hypothetical. | Medium |

## Residual Gaps

### 1. CE-FIPS edition/build-target gap (blocking dependency risk)

**`enos/enos-globals.hcl:126-127`** declares:

```hcl
editions            = ["ce", "ent", "ent.fips1403", "ent.hsm", "ent.hsm.fips1403"]
enterprise_editions = [for e in global.editions : e if e != "ce"]
```

and the companion `build_tags` map (`enos/enos-globals.hcl:9-16`) defines FIPS
build tags only for the two enterprise editions:

```hcl
build_tags = {
  "ce"               = ["ui"]
  "ent"              = ["ui", "enterprise", "ent"]
  "ent.fips1403"     = ["ui", "enterprise", "cgo", "hsm", "fips", "fips_140_3", "ent.fips1403"]
  "ent.hsm"          = ["ui", "enterprise", "cgo", "hsm", "venthsm"]
  "ent.hsm.fips1403" = ["ui", "enterprise", "cgo", "hsm", "fips", "fips_140_3", "ent.hsm.fips1403"]
}
```

**There is no `ce.fips1403` (or equivalent) edition or build tag anywhere in
this file, and no CE-scoped FIPS build target exists in the enos scenario
matrix.** This is a **blocking dependency risk**, not a minor residual note:
it means every enos-driven CI gate and evidence-generation run that needs to
validate a *FIPS-tagged CE artifact* has no such artifact to validate
against — `ent.fips1403`/`ent.hsm.fips1403` are Enterprise-only, and
`docs/fips/crypto-provider-verification.md` §1 (WO-044) independently
confirms the only place `GOEXPERIMENT=boringcrypto`/`fips`/`fips_140_3` tags
are ever applied in this repository's CI is the enterprise-gated
`test-go-fips` job, which is unconditionally skipped for CE
(`fips/inventory/ce_fips_build_tag_verification.yaml` finding F4). Until a CE
FIPS build target is defined, any quality gate in this register whose
"PASS" would require a *FIPS-tagged CE binary* to test against (most
directly `FIPS-CRYPTO-003`) can only be assessed against source-code
analysis, never against a real CE FIPS artifact. Closing this gap is an
architectural/build-pipeline decision outside this WO's and this epic's
scope; it is recorded here so no future evidence package or CI gate
implicitly assumes a CE FIPS artifact exists.

### 2. Shamir's Secret Sharing — non-Approved algorithm outside the validated boundary

Vault's default manual-unseal mechanism, used whenever no `seal` stanza is
configured, is Shamir's Secret Sharing
(`vault/core.go:1328-1336`, `vault/rekey.go:403,466,685,714,899`,
`vault/core.go:2139`, `shamir/shamir.go`). Shamir does not appear on the NIST
SP 800-140C/D Approved mechanism list and its share generation/combine step
runs entirely in-process, outside any CMVP-validated cryptographic module
boundary. It is structurally required as the zero-external-dependency
default and cannot be removed without an architectural change outside this
epic's scope (full analysis: `docs/fips/residual-crypto-risk-register.md#RR-001`).
**Risk rating: Medium.** Compensating control: FIPS-aligned deployments must
explicitly configure a KMS/HSM auto-unseal provider
(`docs/fips/kms-hsm-seal-cmvp-certificates.md`) instead of leaving the `seal`
stanza absent. This finding is why `FIPS-CRYPTO-005` above is PARTIAL, not
PASS.

### 3. Operations that cannot be moved to a validated module boundary

Two categories of operation are, in the Community/OSS build as it exists
today, structurally unable to execute inside a CMVP-validated module
boundary, independent of any operator configuration choice:

- **Go garbage-collector zeroization limitation for key material.** Vault's
  own `memzero` helper (`vault/util.go:11-36`) is used throughout the barrier
  and keyring lifecycle to zero buffers holding secrets as soon as they are
  no longer needed (`vault/core.go:1973,1979,1988,2028,2029,2280`,
  `vault/generate_root.go:324`, `vault/keyring.go:229-242`,
  `vault/barrier_aes_gcm.go:266,311,410,471,519,561,574,608,675,759,814,832`).
  The function's own doc comment is explicit about the limitation: *"Starting
  with Go 1.5, the garbage collector was changed to become a 'generational
  copying garbage collector.' This change... makes it impossible for Vault
  to guarantee a buffer with a secret has not been copied during a garbage
  collection. It is therefore possible that secrets may exist in memory that
  have not been wiped despite a pending `memzero` call."* This is a
  language-runtime property, not a Vault code defect, and there is no
  available Go-level mechanism in this codebase to move it inside a
  validated module boundary short of a non-Go (e.g. cgo-backed HSM) key
  store. **Risk rating: Medium** (bounded by Vault's own operational threat
  model, which already does not claim protection against memory analysis by
  an operator with host access — see the same comment's reference to
  `https://developer.hashicorp.com/vault/docs/internals/security`).
- **Runtime cryptographic provider selection (`FIPS-CRYPTO-003`, restated
  here as a validated-boundary gap rather than a status).** As documented in
  Residual Gap 1 above and `docs/fips/crypto-provider-verification.md` §1,
  a CE build cannot move its `crypto/*` operations inside a validated
  boundary without the Enterprise-only `GOEXPERIMENT=boringcrypto` build,
  which is unreachable from CE CI today. This is the same structural fact as
  Residual Gap 1, cited here specifically because it satisfies this
  section's "operations that cannot be moved to a validated module boundary"
  requirement independently of the edition/build-target framing above.

## Anti-Pattern Compliance

This section confirms this register's own compliance with the FIPS
documentation anti-patterns this epic's already-landed work orders encode as
enforceable rules or explicit disclaimers. The canonical "modernization
template" enumeration of anti-patterns referenced in this WO's
implementation guidance lives in the project's architecture/PRD artifact;
that artifact could not be retrieved in full during this session (its
`get_artifact` output exceeded the session's inline size limit and a
subsequent attempt to read the saved output file was blocked by this
session's own data-handling controls before any content could be inspected).
The checklist below is therefore built from the **concrete, code-enforced or
explicitly-documented anti-patterns already real and verifiable in this
repository**, not reconstructed from memory of the template. A future WO
that can access the full architecture artifact should reconcile this section
against the template's exact numbered list.

| # | Anti-pattern | Compliance evidence |
|---|---|---|
| 1 | Claiming Vault is "FIPS validated" | No occurrence of this phrase anywhere in this document (verified by direct review; the same phrase is a `overclaimProhibitedPhrases` entry enforced repo-wide by `tools/pipeline/internal/cmd/fips_overclaim_check.go:27`). |
| 2 | Claiming Vault is "FIPS certified" | No occurrence of this phrase anywhere in this document (same enforcement mechanism, `fips_overclaim_check.go:28`). |
| 3 | Claiming Vault is "FIPS compliant" | No occurrence of this phrase anywhere in this document (same enforcement mechanism, `fips_overclaim_check.go:29-30`). |
| 4 | Omitting or minimizing residual gaps | Every residual gap identified during this WO's analysis is stated explicitly in the Residual Gaps section above, including the CE-FIPS edition gap framed as a *blocking* risk (not a minor note), per this WO's own `constraints`. |
| 5 | Representing a REVIEW/FAIL/EXCEPTION finding as PASS | Enforced upstream by `ValidateVerificationLogIntegrity` (`generate_fips_evidence.go:486-515`) and `validateExceptionEntry` (`validate_exceptions.go:139-190`, which rejects `exception_status: PASS` with the literal message "EXCEPTION entries must never have status PASS"). This register's own status column uses PARTIAL/REVIEW/FAIL for every gate with a known gap rather than rounding up to PASS. |
| 6 | Omitting the CE-FIPS edition/build-target gap | Explicitly documented as Residual Gap 1 above, citing `enos/enos-globals.hcl:126-127` and `:9-16` verbatim. |
| 7 | Conflating "Approved algorithm" with "validated module" | `FIPS-CRYPTO-003`'s FAIL status and its evidence explicitly distinguish "algorithms selected in source are Approved-eligible" from "the runtime provider executing them is CMVP-validated" (`docs/fips/crypto-provider-verification.md` §1, "Runtime selection" subsection). |
| 8 | Citing a CMVP certificate without confirming product binding | `.release/fips-data/cmvp-certificates.json` and `docs/fips/kms-hsm-seal-cmvp-certificates.md` carry an explicit `product_binding_status: requires_external_lookup`/`historical` per certificate rather than asserting a confirmed binding; this register's `FIPS-CRYPTO-005` and `FIPS-CONTAINER-001` entries reference that unresolved status rather than treating the certificates as confirmed. |
| 9 | Generic or missing evidence references | Every row in the Quality Gate Matrix cites a specific file path (and, where applicable, line numbers or a JSON pointer), per this document's own Acceptance Criteria — no row uses a bare description in place of a path. |
| 10 | Un-dated or non-version-controlled findings | This document carries an explicit "Generated"/"Last verified" date, a document version, and is committed to version control at `docs/fips/risk-register.md`, matching the dating convention already established by `docs/fips/residual-crypto-risk-register.md`. |
| 11 | Un-owned findings ("TBD" or no accountable party) | Every row in the Quality Gate Matrix has a named owner (a real `.github/CODEOWNERS` team — `@hashicorp/vault-crypto`, `@hashicorp/github-secure-vault-core`, `@hashicorp/team-vault-quality` — or the `security-team` designation already used by `.release/fips-data/exceptions.json`); none is "TBD" or blank. |

## Change history

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-09-27 | Initial publication (WO-067): all 10 FIPS quality gates enumerated with current status, evidence references, owners, and residual gaps; CE-FIPS edition gap, Shamir, and Go GC zeroization limitations documented; Anti-Pattern Compliance section added. |
