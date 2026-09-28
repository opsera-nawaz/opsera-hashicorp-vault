# KMS/HSM Seal Integrations — CMVP Certificate Reference

**Work order:** WO-030 | **Epic:** FIPS Phase 3 — Validated Module Boundary, Container Images, and OS-Level FIPS Mode
**Quality gate:** FIPS-CRYPTO-005 (key management evaluation)
**Document version:** 1.0.0
**Generated:** 2026-09-27
**Last verified:** 2026-09-27 (all CMVP lookups below; re-verify against `csrc.nist.gov` before citing in any compliance evidence package — certificates expire, get superseded, or move to Historical status)

## Disclaimer

This document catalogs the FIPS-readiness **posture** of third-party KMS/HSM
seal-wrapping modules that Vault Community Edition (CE) can call via
auto-unseal. It does **not** constitute a FIPS 140-3 validation claim for
Vault itself. Vault's own module boundary and CMVP submission status are
tracked separately in later phases of the FIPS 140-3 Alignment epic. Every
`CMVP certificate` reference below reflects only what could be verified
against `csrc.nist.gov` and vendor documentation on the "last verified" date
above.

## Relationship to WO-010 (`fips/inventory/container_kms_inventory.yaml`)

FIPS Phase 1 (WO-010, merged to `main`) already performed the live NIST CMVP
Validated Modules Search lookups for every KMS provider dispatched by
`internalshared/configutil/kms.go` and recorded the results in
[`fips/inventory/container_kms_inventory.yaml`](../../fips/inventory/container_kms_inventory.yaml)
(`kms_hsm_seal_integrations` section) and its `non_kms_seals` (Shamir) section.
Three candidate certificates were checked and ruled out as **not**
conclusively bound to the branded cloud product (AWS KMS candidate #5146,
Azure candidate #3718, GCP candidate #5272 — full detail below and in that
file's `cmvp_lookup_notes`), and every finding was recorded as
`requires_external_lookup` rather than an invented number.

This document does **not** repeat that NIST lookup (a second query on the
same day would not change the answer, and re-querying without new vendor
evidence would not make the AWS KMS/Azure Key Vault/GCP Cloud KMS product
name any more verifiably bound to a certificate). Instead, it is the
human/audit-facing companion artifact required by WO-030's acceptance
criteria, adding what WO-010's machine-readable inventory does not carry:

1. The exact Vault `seal` HCL stanza syntax and required parameters per provider.
2. Explicit "required configuration for FIPS-aligned operation" guidance.
3. The Enos seal quality-gate coverage gap (AWS-only today — not tracked in WO-010).
4. The cross-references to the PKCS#11/Enterprise boundary and the Shamir/residual-risk register required by AC 3 and AC 4 of WO-030.

If a criterion below duplicates a WO-010 finding verbatim, it is because the
underlying fact (a wrapper package version, a CMVP certificate's real-world
status) does not change between the two documents — duplicating the
*documentation format* here (Markdown tables for operators/auditors, vs.
YAML for CI) is the deliverable WO-030 explicitly asks for; duplicating the
*research* would not be.

---

## 1. AWS KMS

| Field | Value |
|---|---|
| Vault seal stanza type | `seal "awskms"` |
| go-kms-wrapping package | `github.com/hashicorp/go-kms-wrapping/wrappers/awskms/v4` v4.0.4 (`go.mod:114`) |
| Wired in | `internalshared/configutil/kms.go:298-299` (`wrapping.WrapperTypeAwsKms` case) → `kms.go:373-392` (`GetAWSKMSFunc`) |
| FIPS endpoint URL pattern | `kms-fips.<region>.amazonaws.com` (e.g. `kms-fips.us-east-1.amazonaws.com`); FIPS 140-2 endpoint interface VPC endpoint service `com.amazonaws.<region>.kms-fips`, available in all AWS Regions incl. GovCloud (US) since March 2023 |
| CMVP certificate checked | **#5146** — "AWS-LC Cryptographic Module (dynamic)", Overall Level 1. Checked against `csrc.nist.gov` on 2026-09-27 (WO-010). This is AWS's *software* crypto library (BoringSSL/OpenSSL-derived) and is **not** the AWS CloudHSM hardware module that AWS's public FIPS compliance page (`aws.amazon.com/compliance/fips`) associates with the `kms-fips.*` endpoints — must not be cited as the CloudHSM certificate. |
| CMVP status | `requires_external_lookup` — no single certificate number could be conclusively bound to the exact CloudHSM hardware revision (AWS advertises FIPS 140-3 Level 3 for the `hsm2m.medium` instance, GA August 2024, Marvell LiquidSecurity hardware) within this session's public-record search. |
| Last verified | 2026-09-27 |

**Vault config stanza (FIPS-aligned operation):**

```hcl
seal "awskms" {
  region     = "us-east-1"
  kms_key_id = "<key-id>"
  endpoint   = "https://kms-fips.us-east-1.amazonaws.com"
}
```

Required for FIPS-aligned operation: set `endpoint` (or `AWS_KMS_ENDPOINT`
env var, see `internalshared/configutil/kms.go` seal env-config merge at
`mergeKMSEnvConfig`) explicitly to the region's `kms-fips.*` hostname — the
default AWS SDK endpoint resolution does **not** route to the FIPS endpoint
automatically.

## 2. Azure Key Vault

| Field | Value |
|---|---|
| Vault seal stanza type | `seal "azurekeyvault"` |
| go-kms-wrapping package | `github.com/hashicorp/go-kms-wrapping/wrappers/azurekeyvault/v2` v2.0.16 (`go.mod:429`) |
| Wired in | `internalshared/configutil/kms.go:301-302` (`wrapping.WrapperTypeAzureKeyVault` case) → `kms.go:393-410` (`GetAzureKeyVaultKMSFunc`) |
| FIPS endpoint URL pattern | None distinct — FIPS 140-3 Level 3 assurance comes from the **key protection tier** (Managed HSM, or Key Vault Premium with HSM-backed keys), reached via the *same* `vault.azure.net` / `managedhsm.azure.net` hostnames used for non-HSM-backed keys |
| CMVP certificate checked | **#3718** — "NITROXIII CNN35XX-NFBE HSM Family" (Marvell Semiconductor Inc.), Overall Level 3. Checked against `csrc.nist.gov` on 2026-09-27 (WO-010). Status is **Historical** (superseded by #4399) and the certificate text does not reference Microsoft or Azure — must not be cited as "the Azure Managed HSM certificate." |
| CMVP status | `requires_external_lookup` — Microsoft's public statements (June/August 2024) that Managed HSM / Key Vault Premium run on FIPS 140-3 Level 3 Marvell LiquidSecurity 1/2 HSMs could not be bound to a specific public CMVP certificate number for this exact hardware revision within this session. |
| Last verified | 2026-09-27 |

**Vault config stanza (FIPS-aligned operation):**

```hcl
seal "azurekeyvault" {
  tenant_id     = "<tenant-id>"
  client_id     = "<client-id>"
  client_secret = "<client-secret>"
  vault_name    = "<managed-hsm-or-premium-vault-name>"
  key_name      = "<key-name>"
}
```

Required for FIPS-aligned operation: the referenced `vault_name` **must** be
an Azure Key Vault **Managed HSM** instance, or a **Premium**-tier Key Vault
with an HSM-backed key — a Standard-tier Key Vault (software-protected keys)
does not route through the CMVP-relevant HSM boundary at all, and Vault's
`azurekeyvault` wrapper (`internalshared/configutil/kms.go:301-302`) has no
config parameter that enforces this; it is an operator responsibility to
provision the correct vault/key tier.

## 3. GCP Cloud KMS

| Field | Value |
|---|---|
| Vault seal stanza type | `seal "gcpckms"` |
| go-kms-wrapping package | `github.com/hashicorp/go-kms-wrapping/wrappers/gcpckms/v2` v2.0.14 (`go.mod:430`) |
| Wired in | `internalshared/configutil/kms.go:304-305` (`wrapping.WrapperTypeGcpCkms` case) → `kms.go:411-429` (`GetGCPCKMSKMSFunc`) |
| FIPS endpoint URL pattern | None distinct — Cloud KMS selects FIPS posture per `CryptoKey` via `protection_level` (`SOFTWARE` = BoringCrypto Module, FIPS 140-3 Level 1-validated primitives; `HSM` = FIPS 140-3 Level 3 hardware), on the **same** API endpoint (`cloudkms.googleapis.com`) |
| CMVP certificate checked | **#5272** — "Google HSM" (Google, LLC), Active, Overall Level 3, sunset 2031-05-18. Checked against `csrc.nist.gov` on 2026-09-27 (WO-010). This is a *plausible* candidate for the module underlying Cloud HSM, but the certificate page does not explicitly bind the module to the "Cloud KMS / Cloud HSM" product name, so it is not cited here as confirmed. |
| CMVP status | `requires_external_lookup` — pending Google vendor confirmation that certificate #5272 is the specific module backing `protection_level = HSM` keys. |
| Last verified | 2026-09-27 |

**Vault config stanza (FIPS-aligned operation):**

```hcl
seal "gcpckms" {
  project    = "<project-id>"
  region     = "<region>"
  key_ring   = "<key-ring>"
  crypto_key = "<hsm-protection-level-key>"
}
```

Required for FIPS-aligned operation: the referenced `crypto_key` **must**
have been created with `protection_level = HSM` (not the default `SOFTWARE`
level). Vault's `gcpckms` wrapper has no config parameter to verify or
enforce the protection level of an existing key — this is an operator
responsibility, verifiable independently via `gcloud kms keys describe`.

---

## Supplementary providers (dispatched by `kms.go` but not required by WO-030's AC)

For completeness against every non-Enterprise-gated case in
`internalshared/configutil/kms.go`'s `configureWrapper` switch
(`kms.go:288-320`):

| Provider | Seal stanza | Wrapper package | CMVP status | FIPS endpoint |
|---|---|---|---|---|
| AliCloud KMS | `seal "alicloudkms"` | `go-kms-wrapping/wrappers/alicloudkms/v2` v2.0.5 (`go.mod:428`) | `CMVP status unknown — requires vendor confirmation` (no NIST CMVP entry found for "Alibaba Cloud KMS") | None distinct; HSM-backed keys marketed as FIPS 140-3 Level 3 on the standard KMS endpoint |
| OCI KMS | `seal "ocikms"` | `go-kms-wrapping/wrappers/ocikms/v2` v2.0.11 (`go.mod:431`) | `CMVP status unknown — requires vendor confirmation` (no NIST CMVP entry found for "OCI KMS"/"OCI Dedicated KMS") | None distinct; Dedicated KMS HSM partitions marketed as FIPS 140-2 Level 3 on the standard OCI Vault endpoint |
| HashiCorp Transit (auto-unseal via a separate Vault cluster) | `seal "transit"` | `go-kms-wrapping/wrappers/transit/v2` v2.0.13 (`go.mod:432`) | Not applicable — delegates to the Transit engine of a separate Vault cluster; not a third-party CMVP-bearing module. Its FIPS posture is entirely inherited from that upstream cluster's own seal/crypto boundary. | Not applicable |

Full detail and lookup notes for these three: `fips/inventory/container_kms_inventory.yaml` (`kms_hsm_seal_integrations`).

---

## (a) Shamir seal — not a validated cryptographic module

`seal "shamir"` (the implicit default when **no** `seal` stanza is
configured) is **not** a FIPS-Approved algorithm or mechanism under FIPS
140-3 — it does not appear in the SP 800-140C/D Approved lists. Vault's
Shamir implementation (`shamir/shamir.go`) combines unseal-key shares
in-process using `crypto/rand` (share generation) and `math/rand` (polynomial
coefficients), outside any validated cryptographic module boundary.
`internalshared/configutil/kms.go:288-290`'s `configureWrapper` returns a
`nil` wrapper for `wrapping.WrapperTypeShamir` — no external KMS/HSM call is
made at all.

**Recommendation:** Use a KMS auto-unseal provider (AWS KMS, Azure Key
Vault, or GCP Cloud KMS above — or AliCloud/OCI, see supplementary table)
instead of Shamir manual unseal for any FIPS-path production deployment.

**Cross-reference:** This finding will be tracked as risk-register entry
`RR-001` in the residual cryptographic operations risk register
(`docs/fips/residual-crypto-risk-register.md`, WO-047 — FIPS Phase 3,
blocked on this story and not yet landed at the time of writing). Until
WO-047 lands, the authoritative source for the Shamir non-approved-algorithm
finding is `fips/inventory/container_kms_inventory.yaml`'s `non_kms_seals`
section (WO-010) and this document.

## (b) PKCS#11 / HSM — Enterprise-only, out of scope

`seal "pkcs11"` is rejected by the CE build with a hard error:

```go
case wrapping.WrapperTypePkcs11:
    return nil, fmt.Errorf("KMS type 'pkcs11' requires the Vault Enterprise HSM binary")
```

— `internalshared/configutil/kms.go:315-316`. PKCS#11/HSM seal support is
confirmed Enterprise-only (`ubi-hsm-fips` build target, `ent.hsm.fips1403`
edition — see `.github/actions/containerize/action.yml:77-85` and
`fips/inventory/container_kms_inventory.yaml`'s `enterprise_only_fips_images`
section). It is explicitly **out of scope** for Community/OSS FIPS
alignment and is not documented further in this file.

## (c) Enos seal quality-gate coverage gap

`enos/enos-scenario-seal-ha.hcl` (the seal high-availability test scenario)
only exercises two auto-unseal providers via its `primary_seal` /
`secondary_seal` matrix:

```hcl
primary_seal   = ["awskms", "pkcs11"]
secondary_seal = ["awskms", "pkcs11"]
```

(`enos-scenario-seal-ha.hcl:56-57`), asserting only three seal-related
quality gates, defined in `enos/enos-qualities.hcl:587,591,597`:

- `quality.vault_seal_awskms`
- `quality.vault_seal_shamir`
- `quality.vault_seal_pkcs11`

There is **no** `quality.vault_seal_azurekeyvault` or
`quality.vault_seal_gcpckms` gate anywhere in `enos/enos-qualities.hcl`, and
neither `azurekeyvault` nor `gcpckms` appear in the `seal-ha` scenario's
matrix. AWS KMS (Community-eligible) and PKCS#11 (Enterprise-only) are the
only KMS/HSM seal types with automated Enos test coverage today.

**Recommendation (follow-on work, out of scope for this story):** Add
`azurekeyvault` and `gcpckms` to the `primary_seal`/`secondary_seal` matrix
in `enos-scenario-seal-ha.hcl` and define corresponding
`quality.vault_seal_azurekeyvault` / `quality.vault_seal_gcpckms` gates in
`enos-qualities.hcl`, so that both remaining Community-eligible KMS
auto-unseal providers documented in this file have the same automated
seal-HA test coverage as AWS KMS.

---

## Re-verification requirement

Every CMVP certificate reference above (#5146, #3718, #5272, and the
"unknown"/"requires_external_lookup" conclusions for AliCloud and OCI) was
checked against the NIST CMVP Validated Modules Search on the "last
verified" date at the top of this document. CMVP certificates expire, get
superseded (as #3718 already has, by #4399), or move to Historical status.
**Do not cite any certificate number from this document in a compliance
evidence package without re-checking its current status at
`csrc.nist.gov/projects/cryptographic-module-validation-program`.**
