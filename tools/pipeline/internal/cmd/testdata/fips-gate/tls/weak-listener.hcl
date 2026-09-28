listener "tcp" {
  address          = "0.0.0.0:8200"
  tls_min_version  = "1.0"
  tls_cert_file    = "/etc/vault/cert.pem"
  tls_key_file     = "/etc/vault/key.pem"
}
