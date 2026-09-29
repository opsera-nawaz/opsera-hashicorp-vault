/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationSerializer from './application';

import type Store from '@ember-data/store';
import type { ModelSchema } from 'ember-data'; // eslint-disable-line ember/use-ember-data-rfc-395-imports

interface PolicyPayload {
  data: { keys?: string[]; [key: string]: unknown };
}

export default class PolicySerializer extends ApplicationSerializer {
  primaryKey = 'name';

  normalizePolicies(payload: PolicyPayload) {
    const data = payload.data.keys ? payload.data.keys.map((name) => ({ name })) : payload.data;
    return data;
  }

  // @ts-expect-error - concrete override of ApplicationSerializer's normalizeResponse;
  // `normalizedPayload` below is a normalized shape specific to this serializer.
  normalizeResponse(
    store: Store,
    primaryModelClass: ModelSchema,
    payload: PolicyPayload,
    id: string | number,
    requestType: string
  ) {
    const nullResponses = ['deleteRecord'];
    const normalizedPayload = nullResponses.includes(requestType)
      ? { name: id }
      : this.normalizePolicies(payload);
    return super.normalizeResponse(store, primaryModelClass, normalizedPayload as never, id, requestType);
  }
}
