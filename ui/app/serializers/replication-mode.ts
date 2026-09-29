/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationSerializer from './application';

import type Store from '@ember-data/store';
import type { ModelSchema } from 'ember-data'; // eslint-disable-line ember/use-ember-data-rfc-395-imports

export default class ReplicationModeSerializer extends ApplicationSerializer {
  // @ts-expect-error - concrete override of ApplicationSerializer's normalizeResponse;
  // `normalizedPayload` below is a normalized shape specific to this serializer.
  normalizeResponse(
    store: Store,
    primaryModelClass: ModelSchema,
    payload: { id: string | number; data: unknown },
    id: string | number,
    requestType: string
  ) {
    const normalizedPayload = {
      id: payload.id,
      status: payload.data,
    };

    return super.normalizeResponse(store, primaryModelClass, normalizedPayload, id, requestType);
  }
}
