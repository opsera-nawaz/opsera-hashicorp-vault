/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import type { Breadcrumb } from 'vault/app-types';

export function pathIsDirectory(pathToSecret: string | null | undefined): boolean {
  // This regex only checks for / at the end of the string. ex: boop/ === true, boop/bop === false;
  return pathToSecret ? !!pathToSecret.match(/\/$/) : false;
}

export function pathIsFromDirectory(path: string | null | undefined): boolean {
  // This regex just looks for a / anywhere in the path. ex: boop/ === true, boop/bop === true;
  return path ? !!path.match(/\//) : false;
}

interface PathSegment {
  label: string;
  model: string;
}

function splitSegments(secretPath: string): PathSegment[] {
  const segments = secretPath.split('/').filter((path) => path);
  return segments.map((segment, idx) => {
    return {
      label: segment,
      model: segments.slice(0, idx + 1).join('/'),
    };
  });
}

/**
 * breadcrumbsForSecret is for generating page breadcrumbs for a secret path
 * @param backend is the mount path of the kv engine
 * @param secretPath is the full path to secret (like 'my-secret' or 'beep/boop')
 * @param lastItemCurrent
 * @returns array of breadcrumbs specific to KV engine
 */
export function breadcrumbsForSecret(
  backend: string | null | undefined,
  secretPath: string | null | undefined,
  lastItemCurrent = false
): Breadcrumb[] {
  if (!backend || !secretPath) return [];
  const isDir = pathIsDirectory(secretPath);
  const segments = splitSegments(secretPath);

  return segments.map((segment, index) => {
    if (index === segments.length - 1) {
      if (lastItemCurrent) {
        return {
          label: segment.label,
        };
      }
      if (!isDir) {
        return { label: segment.label, route: 'secret.index', models: [backend, segment.model] };
      }
    }
    return { label: segment.label, route: 'list-directory', models: [backend, `${segment.model}/`] };
  });
}
