/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

// Shared, hand-written PKI domain type interfaces for the PKI secrets engine UI.
//
// These are intentionally distinct from the generated @hashicorp/vault-client-typescript
// OpenAPI response/request types (e.g. PkiReadKeyResponse, PkiWriteRoleRequest) already used
// throughout ui/lib/pki/addon. The generated types model the raw, snake_case Vault API wire
// format; the interfaces below model certificate/key/role/ACME concepts at a level that can
// distinguish FIPS 140-3 Approved cryptographic primitives from non-Approved ones, which the
// wire format alone cannot express. ui/app/utils/parse-pki-cert.js (converted in a separate
// story) can import from here once it is migrated to TypeScript.
import type { OrderStatusName } from 'pki/helpers/map-status-badge';

/** Signature algorithms Approved for use under FIPS 140-3. */
export type PkiApprovedSignatureAlgorithm =
  | 'SHA256WithRSA'
  | 'SHA384WithRSA'
  | 'SHA512WithRSA'
  | 'ECDSAWithSHA256'
  | 'ECDSAWithSHA384'
  | 'ECDSAWithSHA512';

/** Signature algorithms Vault supports for display/back-compat that are NOT Approved under FIPS 140-3. */
export type PkiNonApprovedSignatureAlgorithm =
  | 'SHA256WithRSAPSS'
  | 'SHA384WithRSAPSS'
  | 'SHA512WithRSAPSS'
  | 'ED25519'
  | 'PureEd25519';

export type PkiSignatureAlgorithm = PkiApprovedSignatureAlgorithm | PkiNonApprovedSignatureAlgorithm;

/**
 * Discriminated union pairing a signature algorithm with its FIPS-Approved status so callers
 * can narrow on `approved` at compile time instead of re-deriving it from the raw string.
 */
export type PkiSignatureAlgorithmInfo =
  | { algorithm: PkiApprovedSignatureAlgorithm; approved: true }
  | { algorithm: PkiNonApprovedSignatureAlgorithm; approved: false };

const APPROVED_SIGNATURE_ALGORITHMS: ReadonlySet<string> = new Set<PkiApprovedSignatureAlgorithm>([
  'SHA256WithRSA',
  'SHA384WithRSA',
  'SHA512WithRSA',
  'ECDSAWithSHA256',
  'ECDSAWithSHA384',
  'ECDSAWithSHA512',
]);

/** Narrows a signature algorithm string to its FIPS-Approved status. */
export function isApprovedSignatureAlgorithm(algorithm: string): algorithm is PkiApprovedSignatureAlgorithm {
  return APPROVED_SIGNATURE_ALGORITHMS.has(algorithm);
}

export type PkiKeyType = 'rsa' | 'ec' | 'ed25519';

/**
 * Discriminated union flagging Ed25519 keys as non-Approved under FIPS 140-3 while keeping
 * them representable for existing/legacy keys the UI must still display.
 */
export type PkiKeyTypeInfo =
  | { keyType: 'rsa' | 'ec'; approved: true }
  | { keyType: 'ed25519'; approved: false };

/** Narrows a key type string to its FIPS-Approved status. */
export function isApprovedKeyType(keyType: string): keyType is 'rsa' | 'ec' {
  return keyType === 'rsa' || keyType === 'ec';
}

export type PkiSanType = 'dns' | 'ip' | 'uri' | 'email' | 'other';

export interface PkiSAN {
  type: PkiSanType;
  value: string;
}

export interface PkiCertificate {
  serialNumber: string;
  issuer: string;
  subject: string;
  // Optional (rather than required per the literal field list) because pending ACME orders and
  // incomplete/CSR-stage certificates do not have validity bounds yet.
  notBefore?: Date;
  notAfter?: Date;
  signatureAlgorithm: PkiSignatureAlgorithm;
  keyUsage: string[];
  extKeyUsage: string[];
  subjectAltNames: PkiSAN[];
  // Cross-signed certificates chain through more than one issuer path, so this is an array of
  // chains (each itself an ordered array of issuer identifiers) rather than a single chain.
  issuerChains?: string[][];
  isRevoked?: boolean;
  revocationTime?: Date;
}

export interface PkiIssuer {
  issuerId: string;
  issuerName?: string;
  keyId?: string;
  certificate: string;
  caChain: string[];
  isRoot: boolean;
  isDefault: boolean;
  leafNotAfterBehavior?: string;
  revocationSignatureAlgorithm?: PkiSignatureAlgorithm;
}

export interface PkiKey {
  keyId: string;
  keyName?: string;
  keyType: PkiKeyType;
  keyBits?: number;
}

export interface PkiRole {
  name: string;
  issuerRef?: string;
  keyType?: PkiKeyType;
  keyBits?: number;
  ttl?: number;
  maxTtl?: number;
  allowedDomains?: string[];
  keyUsage?: string[];
  extKeyUsage?: string[];
  noStore?: boolean;
}

/**
 * ACME order lifecycle, modeled as a state machine union rather than a bare string so invalid
 * transitions/typos are caught at compile time. Reuses OrderStatusName (already the source of
 * truth for order-status display) rather than declaring a second, potentially drifting union.
 */
export type PkiAcmeOrderStatus = OrderStatusName;

export interface PkiAcmeOrder {
  orderId: string;
  status: PkiAcmeOrderStatus;
  identifiers: string[];
  roleName?: string;
  expires?: Date;
  notBefore?: Date;
  notAfter?: Date;
  certificate?: string;
}
