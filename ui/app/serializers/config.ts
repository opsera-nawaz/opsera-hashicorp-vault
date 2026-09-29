/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import RESTSerializer from '@ember-data/serializer/rest';
import { decamelize } from '@ember/string';

import type Store from '@ember-data/store';
import type { ModelSchema } from 'ember-data'; // eslint-disable-line ember/use-ember-data-rfc-395-imports

interface ConfigPayload {
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export default class ConfigSerializer extends RESTSerializer {
  keyForAttribute(attr: string): string {
    return decamelize(attr);
  }

  normalizeAll(payload: ConfigPayload): ConfigPayload[] {
    if (payload.data) {
      const data = { ...payload, ...payload.data };
      return [data];
    }
    return [payload];
  }

  normalizeResponse(
    store: Store,
    primaryModelClass: ModelSchema,
    payload: ConfigPayload,
    id: string | number,
    requestType: string
  ) {
    const records = this.normalizeAll(payload);
    const { modelName } = primaryModelClass;
    let transformedPayload: Record<string, unknown> = { [modelName]: records };
    // just return the single object because ember is picky
    if (requestType === 'queryRecord') {
      transformedPayload = { [modelName]: records[0] };
    }

    return super.normalizeResponse(store, primaryModelClass, transformedPayload, id, requestType);
  }
}
