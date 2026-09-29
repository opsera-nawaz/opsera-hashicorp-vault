/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import RESTSerializer from '@ember-data/serializer/rest';
import { decamelize } from '@ember/string';

import type Store from '@ember-data/store';
import type { ModelSchema } from 'ember-data'; // eslint-disable-line ember/use-ember-data-rfc-395-imports

export default class PathFilterConfigSerializer extends RESTSerializer {
  keyForAttribute(attr: string): string {
    return decamelize(attr);
  }

  normalizeResponse(
    store: Store,
    primaryModelClass: ModelSchema,
    payload: { data: Record<string, unknown> },
    id: string | number,
    requestType: string
  ) {
    const { modelName } = primaryModelClass;
    payload.data['id'] = id;
    const transformedPayload = { [modelName]: payload.data };
    return super.normalizeResponse(store, primaryModelClass, transformedPayload, id, requestType);
  }
}
