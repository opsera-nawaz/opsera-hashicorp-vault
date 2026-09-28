# Migrating Transit keys from ChaCha20-Poly1305 to AES-GCM under FIPS 140-3

ChaCha20-Poly1305 is not an Approved symmetric encryption algorithm under
FIPS 140-3 (only AES-GCM, per SP 800-38D, qualifies). When Vault is running
in FIPS mode:

- **New encryption** (`POST /transit/encrypt/:name`) against a
  `chacha20-poly1305` key is rejected with HTTP 400 and an error naming
  `aes256-gcm96` as the Approved alternative.
- **Decryption** (`POST /transit/decrypt/:name`, and `POST
  /transit/rewrap/:name`'s internal decrypt step) of *existing*
  `chacha20-poly1305` ciphertext keeps working, indefinitely, regardless of
  FIPS mode. No previously-encrypted data becomes unreadable.
- **Key export** (`GET /transit/export/:type/:name`) of a
  `chacha20-poly1305` key's material is unaffected by FIPS mode, so it
  remains available as an escape hatch for migrating key material outside
  Vault if ever needed.

This means an operator with an existing `chacha20-poly1305` key does not
lose access to their data when FIPS mode is turned on, but they can no
longer write *new* ciphertext with that key. This document describes how to
move fully off ChaCha20-Poly1305 and onto AES-256-GCM.

## Recommended procedure: migrate ciphertext to a new AES-256-GCM key

This is the procedure fully supported by Vault's public API today, and
requires no key material export/import.

1. **Create a new AES-256-GCM key** to receive the migrated data:

   ```shell
   vault write -f transit/keys/<new-name> type=aes256-gcm96
   ```

2. **For each value currently encrypted under the old `chacha20-poly1305`
   key**, decrypt it under the old key and re-encrypt it under the new key:

   ```shell
   PLAINTEXT=$(vault write -field=plaintext transit/decrypt/<old-name> \
     ciphertext=<old-ciphertext>)

   NEW_CIPHERTEXT=$(vault write -field=ciphertext transit/encrypt/<new-name> \
     plaintext="$PLAINTEXT")
   ```

   Use the `batch_input` form of `/transit/decrypt` and `/transit/encrypt`
   to migrate many values per request rather than one API call per value.
   This step works identically whether FIPS mode is on or off: the decrypt
   half is never gated, and the encrypt half targets an already-Approved
   key type.

3. **Update the calling application** to store `NEW_CIPHERTEXT` (and the
   new key name) in place of the old ciphertext, so future reads go through
   `<new-name>`.

4. **Verify** by decrypting `NEW_CIPHERTEXT` under `<new-name>` and
   confirming it matches the original plaintext before removing the old
   value.

5. **Once all ciphertext referencing `<old-name>` has been migrated and
   verified**, retire the old key. If nothing decrypts under it any more,
   it's safe to disable further use and delete it:

   ```shell
   vault write transit/keys/<old-name>/config deletion_allowed=true
   vault delete transit/keys/<old-name>
   ```

   Deleting a key is irreversible -- keep it (with `deletion_allowed`
   unset) until you have confirmed nothing still depends on it, e.g. via
   audit log review or an application-side migration-complete flag.

## Re-encrypting within a single key via rewrap

`POST /transit/rewrap/:name` re-encrypts ciphertext under a named key's
*current latest version*: it decrypts with whichever version produced the
ciphertext, then re-encrypts with the latest one. If a key's latest version
is already an Approved type (e.g. after a version-level algorithm change),
rewrap is a convenient way to move existing `chacha20-poly1305`-encrypted
values (from older versions of that same key) onto the new version without
the application needing to decrypt/re-encrypt itself:

```shell
vault write transit/rewrap/<name> ciphertext=<old-ciphertext>
```

Rewrap only ever operates within one named key -- it cannot move ciphertext
between two different key names, since decrypting and re-encrypting both
happen against the same key's stored key material. It is therefore a
complement to, not a replacement for, the cross-key procedure above when
retiring a `chacha20-poly1305` key entirely.

## Convergent encryption

The same encrypt-reject/decrypt-allow split applies when convergent
encryption is enabled: new convergent encryption against a
`chacha20-poly1305` key is rejected under FIPS mode exactly like
non-convergent encryption, and existing convergent ciphertext keeps
decrypting. The migration procedure above applies unchanged -- create the
new AES-256-GCM key with the same `derived`/`convergent_encryption`
settings you need, then decrypt/re-encrypt as usual.

## Batch requests

For `/transit/encrypt`, a batch request that mixes an Approved-key item
with a `chacha20-poly1305`-key item fails as a whole under FIPS mode (HTTP
400): Vault does not partially apply a batch when any item in it is
rejected, unless the caller opts into partial-failure semantics via
`partial_failure_response_code`. Plan migrations so that a given batch call
either targets only already-migrated (Approved) keys, or is understood to
fail outright while any `chacha20-poly1305` key in it is still in use for
encryption.
