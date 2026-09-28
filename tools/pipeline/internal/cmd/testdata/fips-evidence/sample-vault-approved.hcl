ui = true

storage "file" {
  path = "/opt/vault/data"
}

listener "tcp" {
  address           = "0.0.0.0:8200"
  tls_cert_file     = "/opt/vault/tls/tls.crt"
  tls_key_file      = "/opt/vault/tls/tls.key"
  tls_min_version   = "tls12"
  tls_cipher_suites = "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384"
}
