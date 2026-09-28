/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import isDeleted from 'kv/helpers/is-deleted';

import type { KvMetadataVersion } from 'kv/utils/kv-types';

export type SortedVersion = KvMetadataVersion & { version: string; isSecretDeleted: boolean };

export default function sortedVersions(
  versions: Record<string, KvMetadataVersion> | undefined
): SortedVersion[] {
  const array: SortedVersion[] = [];
  for (const key in versions) {
    const version = versions[key] as KvMetadataVersion;
    const isSecretDeleted = isDeleted(version.deletion_time);
    array.push({ version: key, isSecretDeleted, ...version });
  }
  // version keys are in order created with 1 being the oldest, we want newest first
  return array.reverse();
}
