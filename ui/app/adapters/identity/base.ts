/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationAdapter from '../application';

import type Store from '@ember-data/store';
import type { AdapterModelSchema } from '../-types';

export default class IdentityAdapter extends ApplicationAdapter {
  namespace = 'v1';
  pathForType(type: string): string {
    return type;
  }

  urlForQuery(query: unknown, modelName: string): string {
    return super.urlForQuery(query as object, modelName as never) + '?list=true';
  }

  query(_store: Store, type: AdapterModelSchema) {
    return this.ajax(this.buildURL(type.modelName, null, null, 'query'), 'GET');
  }

  buildURL(
    modelName?: string,
    id?: string | unknown[] | Record<string, unknown> | null,
    snapshot?: unknown[] | null,
    requestType?: string,
    query?: object
  ): string {
    if (requestType === 'createRecord') {
      return super.buildURL(modelName as never, id, snapshot, requestType, query);
    }
    return super.buildURL(`${modelName}/id` as never, id, snapshot, requestType, query);
  }
}
