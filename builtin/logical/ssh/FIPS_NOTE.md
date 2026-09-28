# SSH Engine: Ed25519 and FIPS -- Two Separate Enforcement Layers

This note clarifies scope for WO-043 ("Migrate Ed25519/X25519 to
ECDSA/ECDH NIST curves"), which does **not** change anything in this
package. It exists so the SSH engine's own Ed25519 support isn't mistaken
for something WO-043 left half-done.

There are two independent places where Ed25519 and FIPS 140-3 interact for
SSH, and they are enforced by different layers, for different reasons:

## 1. Vault-internal key-policy FIPS gate (Transit/`sdk/helper/keysutil`)

`sdk/helper/keysutil.KeyType.IsFIPSApproved()` (WO-027) and the FIPS check
added to `(*Policy).SignWithOptions` (WO-043; see
`builtin/logical/transit/FIPS_MIGRATION.md`) govern whether **Vault itself**
will create a new Ed25519 key, or produce a new Ed25519 *signature*, when
running in FIPS mode. This is Vault deciding, at the key-policy layer,
which algorithms it is willing to originate.

The SSH secrets engine's CA functionality (`path_config_ca.go`,
`path_issue.go`, `path_issue_sign.go`) can use an Ed25519 CA key the same
way Transit does, and is subject to the exact same gate for the exact same
reason: signing a new SSH certificate with an Ed25519 CA key is "producing
a new Ed25519 signature," which this story's FIPS gate blocks. Verifying
an existing Ed25519-signed certificate is not gated, for the same
backward-compatibility reason described in
`builtin/logical/transit/FIPS_MIGRATION.md`.

## 2. SSH transport-level algorithm negotiation (`PubkeyAcceptedAlgorithms`)

Separately, and at a completely different layer, an SSH *server*
(`sshd_config`'s `PubkeyAcceptedAlgorithms`, or the client's equivalent
setting) decides which public-key algorithms -- including `ssh-ed25519`,
the SSH wire-protocol name for Ed25519 -- it will accept for
authentication, independent of who issued the certificate or which tool
generated the key. This is enforced by the SSH implementation doing the
negotiation (OpenSSH, `golang.org/x/crypto/ssh`, etc.), not by Vault. Vault
has no code path that participates in this negotiation: it issues
certificates and keys, but does not run an SSH server or client itself.

`builtin/logical/ssh/backend_test.go`'s `TestSSHBackend_CA_FIPS` is the
existing test for this layer: it drives a real `sshd` in a test container
configured with a restrictive `PubkeyAcceptedAlgorithms` allowlist (e.g.
accepting `rsa-sha2-256-cert-v01@openssh.com` but rejecting the SHA-1-based
`ssh-rsa-cert-v01@openssh.com`) and asserts that the *transport* rejects
disallowed algorithms regardless of what Vault issued. Extending that same
pattern to explicitly exercise `ssh-ed25519`/`ssh-ed25519-cert-v01@openssh.com`
acceptance/rejection would be additional coverage for *this* layer, but is
a transport-negotiation test, not a Vault key-policy change -- it would
not touch `sdk/helper/keysutil` or any file this story modifies.

## Why this distinction matters

An operator locking down FIPS compliance needs to configure **both**
layers if Ed25519 must be fully excluded end-to-end:

* Vault's key-policy FIPS gate (automatic once Vault is built/run in FIPS
  mode) stops Vault from *originating* new Ed25519 keys or signatures.
* The SSH server/client's `PubkeyAcceptedAlgorithms` (an operator-managed
  `sshd_config`/client setting, entirely outside Vault) stops the SSH
  *transport* from accepting `ssh-ed25519` authentication, regardless of
  where the key came from.

WO-043 explicitly does not modify SSH transport-level algorithm
negotiation -- that configuration surface belongs to the SSH server/client,
not to Vault's key-policy layer, and changing it is out of scope for this
story.
