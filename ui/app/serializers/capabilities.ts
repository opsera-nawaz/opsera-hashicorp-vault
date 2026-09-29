/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationSerializer from './application';

import type Store from '@ember-data/store';
import type { ModelSchema } from 'ember-data'; // eslint-disable-line ember/use-ember-data-rfc-395-imports

interface CapabilitiesPayload {
  path?: string;
  pathMap?: Record<string, string>;
  data: Record<string, unknown>;
}

export default class CapabilitiesSerializer extends ApplicationSerializer {
  primaryKey = 'path';

  // @ts-expect-error - concrete override of ApplicationSerializer's normalizeResponse; `response`
  // below is a normalized shape specific to this serializer, not the raw NormalizeItemsPayload.
  normalizeResponse(
    store: Store,
    primaryModelClass: ModelSchema,
    payload: CapabilitiesPayload,
    id: string | number,
    requestType: string
  ) {
    let response;
    // queryRecord will already have set path, and we won't have an id here
    if (id) payload.path = id as string;

    if (requestType === 'query') {
      // each key on the response is a path with an array of capabilities as its value
      response = Object.keys(payload.data).map((fullPath) => {
        // we use pathMap to normalize a namespace-prefixed path back to the relative path
        // this is okay because we clear capabilities when moving between namespaces
        const path = payload.pathMap ? payload.pathMap[fullPath] : fullPath;
        return { capabilities: payload.data[fullPath], path };
      });
    } else {
      response = { ...payload.data, path: payload.path };
    }
    return super.normalizeResponse(store, primaryModelClass, response as never, id, requestType);
  }

  modelNameFromPayloadKey(): string {
    return 'capabilities';
  }
}
