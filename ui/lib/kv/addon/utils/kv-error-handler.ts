/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import type { ApiErrorResponse } from 'vault/api';

/**
 * The shape of the returned object depends on which failed request called it: fetchSubkeys
 * (routes/secret.ts) expects { metadata } (a KvSubkeysResponse), while the secret data read
 * (routes/secret/details.ts) expects { data, metadata } (the same envelope as a successful
 * kvV2Read). The real error body's `data` field carries whichever shape the failed endpoint
 * would have returned on success, which ApiErrorResponse doesn't model — callers cast the
 * result to the shape their endpoint's error body carries.
 */
export function kvErrorHandler(
  status: number | undefined,
  errorResponse: ApiErrorResponse | undefined
): Record<string, unknown> {
  // if it's a legitimate error - throw it!
  if (errorResponse?.isControlGroupError) {
    throw errorResponse;
  }

  if (typeof errorResponse === 'object' && errorResponse !== null) {
    const data = errorResponse.data as Record<string, unknown> | undefined;

    if (status === 403) {
      return {
        failReadErrorCode: 403,
      };
    }

    // in the case of a deleted/destroyed secret the API returns a 404 because { data: null }
    // however, there could be a metadata block with important information like deletion_time
    // handleResponse below checks 404 status codes for metadata and updates the code to 200 if it exists.
    // we still end up in the good ol' catch() block, but instead of a 404 adapter error we've "caught"
    // the metadata that sneakily tried to hide from us
    if (data) {
      return data;
    }
  }

  // if we get here, it's likely either a script error or 404 because it doesn't exist
  throw errorResponse;
}
