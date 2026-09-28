# Transit Ed25519 -> ECDSA FIPS Migration

This document covers the Transit engine's FIPS 140-3 posture for `KeyType_ED25519`
(WO-043, epic "FIPS Phase 2 -- Approved-Algorithm Configuration and
Enforcement"). It builds on WO-027, which added
`KeyType.IsFIPSApproved()` (`sdk/helper/keysutil/policy.go`) and gated new key
*creation/rotation* under FIPS mode. WO-043 extends that gate to the *sign*
operation, while leaving *verify* ungated.

## What is enforced, and where

`sdk/helper/keysutil/policy.go`'s `(*Policy) SignWithOptions` now returns an
`errutil.UserError` (surfaced by the Transit backend as HTTP 400) whenever
`isFIPSMode()` is true and the key's type is not FIPS-Approved -- today that
is `KeyType_ChaCha20_Poly1305` and `KeyType_ED25519`:

```
key type ed25519 is not allowed in FIPS mode; use ecdsa-p256, ecdsa-p384, or ecdsa-p521 instead
```

This applies to `POST /transit/sign/:name` for every Ed25519 signing mode
(plain, `Ed25519ctx`, `Ed25519ph`/`prehashed`), because the gate is on the
key type itself, not on how the sign request is shaped. A batch sign request
with a mix of key types fails as a whole if *any* item targets a
non-Approved key while in FIPS mode, since batch items share one
`Policy`/key.

`(*Policy) VerifySignatureWithOptions` has **no** FIPS check, deliberately.
`POST /transit/verify/:name` continues to validate Ed25519 signatures --
new or old -- under FIPS mode exactly as it does today. This is required so
that data, tokens, and certificates signed with an Ed25519 key before FIPS
mode was enabled remain verifiable indefinitely; no existing signature is
ever invalidated by this story. Key export (`GET /transit/export/...`) is
likewise unaffected, so operators can still pull Ed25519 key material out
for the external migration procedure below.

In short: **existing Ed25519 keys keep working for verification forever;
only the creation of *new* signatures with an Ed25519 key is blocked once
FIPS mode is on.**

## Wire format differences

Ed25519 and ECDSA are not wire-compatible. A consumer that only understands
one cannot parse a signature produced by the other. Concretely, in
`sdk/helper/keysutil/policy.go`:

| Property              | Ed25519 (`signWithEd25519`)                          | ECDSA (`signWithECDSA`)                                             |
|------------------------|-------------------------------------------------------|-----------------------------------------------------------------------|
| Signature length       | Fixed 64 bytes, always                                | Variable: depends on the ASN.1 encoding of `R`/`S` (typically ~70-72 bytes for P-256, ~103-104 for P-384, ~139-141 for P-521) |
| Encoding (`asn1`)      | Raw 64-byte string; not ASN.1 at all                  | ASN.1 DER `SEQUENCE { R INTEGER, S INTEGER }` (used by OpenSSL/X.509) |
| Encoding (`jws`)       | Raw 64-byte string (no distinct JWS form)              | Fixed-width big-endian `R \|\| S` concatenation, zero-padded to the curve's coordinate size (32 bytes/coordinate for P-256, 48 for P-384, 66 for P-521 -- see `signWithECDSA`'s `keyLen` computation) |
| Key size               | 32-byte private seed / 32-byte public key             | Curve-dependent: P-256 = 32 bytes, P-384 = 48 bytes, P-521 = 66 bytes per coordinate |
| Hashing                | None by default (PureEdDSA); `Ed25519ph` pre-hashes with SHA-512 as an explicit opt-in | Pre-hashed by the Transit layer before `ecdsa.Sign` (`KeyType.HashSignatureInput() == true`) using the request's `hash_algorithm` |

**JWS marshaling in particular is not interchangeable**: Ed25519's `jws`
marshaling is just the same 64-byte signature (there is no ASN.1 form to
begin with), whereas ECDSA's `jws` marshaling is the RFC 7518 `R || S`
concatenation -- a completely different byte layout from its own `asn1`
form, let alone from Ed25519's. A downstream verifier (e.g. a JWT library)
that assumes "EdDSA" (`alg: EdDSA`) cannot verify an ECDSA-produced token,
and vice versa; the `alg` header must change along with the key.

The version-prefixed wire envelope Vault wraps around either
(`vault:v<N>:<base64>`, `getVersionPrefix`) is identical in both cases --
only the base64-decoded payload's internal format differs as described
above.

## Migration procedure

Because the signature formats are incompatible, migrating a key from
Ed25519 to ECDSA is **not** an in-place algorithm swap; it is a
create-new-key-and-re-sign operation:

1. **Create a new ECDSA key.** Pick P-256, P-384, or P-521 (all FIPS
   186-5 Approved and all usable in FIPS mode):
   ```
   vault write transit/keys/<name>-ecdsa type=ecdsa-p256
   ```
2. **Re-sign data with the new key.** Any data, token, or certificate that
   was signed with the old Ed25519 key needs a new signature from the
   ECDSA key; there is no conversion path from an Ed25519 signature to an
   ECDSA one for the same payload.
3. **Update verification endpoints/consumers.** Downstream verifiers must
   be updated to expect ECDSA's signature format (ASN.1 DER or `R || S`,
   per the table above) and, if applicable, a different `alg`/key-type
   identifier, *before* they start receiving ECDSA-signed data.
4. **Dual-verify during rollout.** Until every consumer has been updated,
   keep verifying against both the old Ed25519 key and the new ECDSA key
   (`POST /transit/verify/:name` against each key name) -- this is safe
   under FIPS mode, since verification of the pre-existing Ed25519 key is
   never blocked.
5. **Optionally archive the old Ed25519 key** (`vault write
   transit/keys/<name>/config min_decryption_version=<n>`, or delete it
   once you are certain nothing will ever need to verify against it again)
   once every consumer has migrated to the ECDSA key. Do not delete it
   while any previously-issued Ed25519 signature might still need to be
   verified.

## Out of scope for this story

* **ChaCha20-Poly1305 -> AES-GCM migration** and **hash algorithm changes**
  are separate concerns (see the other Phase-2 FIPS work orders); this
  document only covers `KeyType_ED25519`.
* **SSH transport-level Ed25519** is a *different enforcement layer* from
  everything described above -- see `builtin/logical/ssh/FIPS_NOTE.md`.
