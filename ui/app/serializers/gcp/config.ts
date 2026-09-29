/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationSerializer from '../application';

import type Store from '@ember-data/store';
import type { ModelSchema } from 'ember-data'; // eslint-disable-line ember/use-ember-data-rfc-395-imports

interface GcpConfigPayload {
  id?: string | number;
  backend?: string;
  data?: Record<string, unknown>;
}

export default class GcpConfigSerializer extends ApplicationSerializer {
  normalizeResponse(
    store: Store,
    primaryModelClass: ModelSchema,
    payload: GcpConfigPayload,
    id: string | number,
    requestType: string
  ) {
    if (!payload.data) {
      return super.normalizeResponse(store, primaryModelClass, payload as never, id, requestType);
    }

    const normalizedPayload = {
      id: payload.id,
      backend: payload.backend,
      data: {
        ...payload.data,
      },
    };
    return super.normalizeResponse(store, primaryModelClass, normalizedPayload, id, requestType);
  }
}
