/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

// vault/lib/token-storage.js has not been converted to TS yet, so this ambient
// declaration types the shape consumers rely on (auth.ts). Remove once the
// underlying file is converted.
export interface TokenStorage {
  getItem(key: string): unknown;
  setItem(key: string, val: unknown): void;
  removeItem(key: string): void;
  keys(): string[];
}

export default function getStorage(type?: 'memory'): TokenStorage;
