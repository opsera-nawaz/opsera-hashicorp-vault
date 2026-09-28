/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

interface ParsedCertificateData {
  parsing_errors: Array<Error>;
  can_parse: boolean;

  // certificate values
  common_name: string;
  serial_number: string;
  ou: string;
  organization: string;
  country: string;
  locality: string;
  province: string;
  street_address: string;
  postal_code: string;
  key_usage: string;
  other_sans: string;
  alt_names: string;
  uri_sans: string;
  ip_sans: string;
  permitted_dns_domains: string;
  max_path_length: number;
  exclude_cn_from_sans: boolean;
  signature_bits: string;
  use_pss: boolean;
  expiry_date: date; // remove along with old PKI work
  issue_date: date; // remove along with old PKI work
  not_valid_after: number;
  not_valid_before: number;
  ttl: Duration;
}
export function parseCertificate(certificateContent: string): ParsedCertificateData;

// Verifies certA/certB chain to (are signed by) each other; pass the same certificate as both
// arguments to check if it is self-signed (i.e. a root certificate). When `leaf` is provided,
// verifies that both certA and certB signed leaf and that their subjects match leaf's issuer,
// used to confirm a cross-sign completed correctly.
export function verifyCertificates(certA: string, certB: string, leaf?: string): Promise<boolean>;
