# Copyright IBM Corp. 2016, 2025
# SPDX-License-Identifier: BUSL-1.1

variable "hosts" {
  type = map(object({
    public_ip = string
  }))
  description = "SSH-reachable target hosts (e.g. module.target_ec2_fips's `hosts` output) to run the OS-level FIPS mode and OpenSSL FIPS provider checks against"
}

variable "vault_addr" {
  type        = string
  description = "The Vault API address to verify TLS negotiation against, e.g. http://127.0.0.1:8200. When empty, the TLS negotiation check is skipped entirely"
  default     = ""
}

variable "allowed_tls_ciphers" {
  type        = list(string)
  description = "Approved TLS cipher suite names (TLS 1.2 IANA names or TLS 1.3 equivalents) that the Vault listener may negotiate"
  default     = ["TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384", "TLS_AES_256_GCM_SHA384", "TLS_AES_128_GCM_SHA256"]
}
