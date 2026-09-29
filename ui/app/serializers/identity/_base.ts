/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationSerializer from '../application';

/**
 * Raw alias entry as returned nested inside entity/group key_info (and as the
 * embedded `alias`/`aliases` relationship on single-record responses).
 */
export interface RawIdentityAliasKeyInfo {
  id?: string;
  name?: string;
  canonical_id?: string;
  mount_accessor?: string;
  mount_path?: string;
  mount_type?: string;
  creation_time?: string;
  last_update_time?: string;
  custom_metadata?: Record<string, string> | null;
  metadata?: Record<string, string> | null;
  local?: boolean;
  [key: string]: unknown;
}

/**
 * Raw key_info shape for an entity, as returned by GET /identity/entity/id
 * (list endpoint, `key_info[id]`).
 */
export interface RawIdentityEntityKeyInfo {
  id?: string;
  name: string;
  backend?: string;
  disabled?: boolean;
  creation_time?: string;
  last_update_time?: string;
  merged_entity_ids?: string[] | null;
  metadata?: Record<string, string> | null;
  policies?: string[];
  aliases?: RawIdentityAliasKeyInfo[];
  [key: string]: unknown;
}

/**
 * Raw key_info shape for a group, as returned by GET /identity/group/id
 * (list endpoint, `key_info[id]`).
 */
export interface RawIdentityGroupKeyInfo {
  id?: string;
  name: string;
  backend?: string;
  type?: 'internal' | 'external';
  creation_time?: string;
  last_update_time?: string;
  member_entity_ids?: string[] | null;
  member_group_ids?: string[] | null;
  parent_group_ids?: string[] | null;
  metadata?: Record<string, string> | null;
  policies?: string[] | null;
  alias?: RawIdentityAliasKeyInfo;
  [key: string]: unknown;
}

/** Union of every key_info shape the identity list endpoints can return. */
export type RawIdentityKeyInfo = RawIdentityEntityKeyInfo | RawIdentityGroupKeyInfo | RawIdentityAliasKeyInfo;

/**
 * Shape of `/identity/<entity|group>/id?list=true` responses before
 * normalization: an array of ids (`keys`) plus a lookup map (`key_info`)
 * keyed by id. `keys` may already be an array of expanded objects rather
 * than strings when `extractLazyPaginatedData` has run first (see the
 * `pagination` service).
 */
export interface RawIdentityListResponse<T extends RawIdentityKeyInfo = RawIdentityKeyInfo> {
  data?: {
    keys?: string[] | (T & { id: string })[];
    key_info?: Record<string, T>;
    [key: string]: unknown;
  };
  backend?: string;
  _requestQuery?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Single-record identity API response shape, e.g. GET /identity/entity/id/:id. */
export interface RawIdentityRecordResponse {
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

/** JSON:API resource produced once a normalized payload is assembled for Ember Data. */
export interface NormalizedIdentityResource {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}

/**
 * Output of `normalizeResponse`, matching the Ember Data JSON:API document
 * format that `ApplicationSerializer#normalizeResponse` returns once it has
 * run the flattened result of `normalizeItems` through the base
 * `JSONSerializer` normalization.
 */
export interface NormalizedIdentityPayload {
  data: NormalizedIdentityResource | NormalizedIdentityResource[];
  included?: NormalizedIdentityResource[];
}

export default class IdentityBaseSerializer extends ApplicationSerializer {
  /**
   * Extracts the keys array into individual objects with the key as the id, if it exists.
   * This is for endpoints that return a list of keys and a separate key_info object with
   * the details for each key, such as the list endpoint for entities.
   */
  normalizeItems(
    payload: RawIdentityListResponse | RawIdentityRecordResponse
  ): (RawIdentityKeyInfo & { id: string })[] | Record<string, unknown> {
    const listPayload = payload as RawIdentityListResponse;
    if (listPayload.data?.keys && Array.isArray(listPayload.data.keys)) {
      if (typeof listPayload.data.keys[0] !== 'string') {
        // If keys is not an array of strings, it was already normalized into objects in extractLazyPaginatedData
        return listPayload.data.keys as (RawIdentityKeyInfo & { id: string })[];
      }
      return (listPayload.data.keys as string[]).map((key) => {
        // key_info is expected to contain an entry for every id in `keys`; a non-null
        // assertion preserves the original untyped behavior (throw on a missing entry)
        // rather than introducing a new guard that would change runtime behavior.
        const model = listPayload.data?.key_info?.[key]!;
        model.id = key;
        return model;
      }) as (RawIdentityKeyInfo & { id: string })[];
    }
    if (payload.data) {
      Object.assign(payload, payload.data);
      delete payload.data;
    }
    return payload;
  }
}
