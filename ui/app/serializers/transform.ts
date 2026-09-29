/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationSerializer from './application';

import type Store from '@ember-data/store';
import type { ModelSchema } from 'ember-data'; // eslint-disable-line ember/use-ember-data-rfc-395-imports
import type { AdapterSnapshot } from 'vault/adapters/-types';

interface TransformPayload {
  data?: { masking_character?: number | string; keys?: string[]; [key: string]: unknown };
  backend?: string;
  [key: string]: unknown;
}

interface TransformItem {
  id: string;
  name: string;
  backend?: string;
}

export default class TransformSerializer extends ApplicationSerializer {
  normalizeResponse(
    store: Store,
    primaryModelClass: ModelSchema,
    payload: TransformPayload,
    id: string | number,
    requestType: string
  ) {
    if (payload.data?.masking_character) {
      payload.data.masking_character = String.fromCharCode(payload.data.masking_character as number);
    }
    return super.normalizeResponse(store, primaryModelClass, payload, id, requestType);
  }

  // @ts-expect-error - concrete override of JSONSerializer's generic serialize<K>; the loose
  // AdapterSnapshot stand-in isn't assignable to Snapshot<K>.
  serialize(snapshot: AdapterSnapshot, options?: object) {
    const json = super.serialize(snapshot as never, options ?? {}) as { template?: unknown[] | unknown };
    if (json.template && Array.isArray(json.template)) {
      // Transformations should only ever have one template
      json.template = json.template[0];
    }
    return json;
  }

  extractLazyPaginatedData(payload: { data: { keys: string[] }; backend?: string }): TransformItem[] {
    return payload.data.keys.map((key) => {
      const model: TransformItem = {
        id: key,
        name: key,
      };
      if (payload.backend) {
        model.backend = payload.backend;
      }
      return model;
    });
  }
}
