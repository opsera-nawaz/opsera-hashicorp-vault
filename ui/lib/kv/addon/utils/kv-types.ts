/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

// Shared type definitions for the KV v2 engine.
//
// The generated @hashicorp/vault-client-typescript response models (e.g.
// KvV2ReadMetadataResponse, KvV2ReadResponse, KvV2ReadSubkeysResponse) type
// their nested payloads as plain `object` because the OpenAPI spec doesn't
// model KV's dynamic maps (`versions`, `data`, `subkeys`, `metadata`). These
// interfaces describe the actual shapes the KV UI relies on so routes and
// components can work with them without `any`.

export interface KvMetadataVersion {
  created_time: string;
  deletion_time: string;
  destroyed: boolean;
}

export interface KvSecretMetadata {
  cas_required: boolean;
  created_time: string;
  current_version: number;
  custom_metadata: Record<string, string> | null;
  delete_version_after: string;
  max_versions: number;
  oldest_version: number;
  updated_time: string;
  versions: Record<string, KvMetadataVersion>;
}

// Result of `kvV2Read`, flattened with the metadata spread onto the data envelope
// (see routes/secret/details.ts) or a `failReadErrorCode` when the read failed.
export interface KvSecretDataModel {
  secretData?: Record<string, unknown>;
  version?: number;
  created_time?: string;
  deletion_time?: string;
  destroyed?: boolean;
  custom_metadata?: Record<string, string> | null;
  failReadErrorCode?: number;
}

export interface KvSubkeysMetadata {
  version: number;
  created_time: string;
  custom_metadata: Record<string, string> | null;
  deletion_time: string;
  destroyed: boolean;
}

// Result of `kvV2ReadSubkeys`, or the shape kvErrorHandler derives from a failed read
// (in which case `subkeys` is absent and either `metadata` or `failReadErrorCode` is set).
export interface KvSubkeysResponse {
  subkeys?: Record<string, unknown> | null;
  metadata?: KvSubkeysMetadata;
  failReadErrorCode?: number;
}

// Friendly capability names mapped from the raw ACL paths in routes/secret.ts's fetchCapabilities.
export interface KvCapabilities {
  canReadData: boolean;
  canUpdateData: boolean;
  canPatchData: boolean;
  canCreateVersionData: boolean;
  canDeleteVersion: boolean;
  canDeleteLatestVersion: boolean;
  canDestroyVersion: boolean;
  canReadMetadata: boolean;
  canDeleteMetadata: boolean;
  canUpdateMetadata: boolean;
  canUndelete: boolean;
  canReadSubkeys: boolean;
}
