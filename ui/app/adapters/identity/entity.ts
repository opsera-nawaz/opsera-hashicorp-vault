/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import IdentityAdapter from './base';

import type Store from '@ember-data/store';
import type { AdapterSerializer } from '../-types';

export default class EntityAdapter extends IdentityAdapter {
  lookup(store: Store, data: Record<string, unknown>) {
    const urlPrefix = (this as unknown as { urlPrefix: () => string }).urlPrefix();
    const url = `/${urlPrefix}/identity/lookup/entity`;
    return this.ajax(url, 'POST', { data }).then((response: { data: { id: string } } | undefined) => {
      // unsuccessful lookup is a 204
      if (!response) return;
      const modelName = 'identity/entity' as never;
      const serializer = store.serializerFor(modelName) as AdapterSerializer;
      store.push(
        serializer.normalizeResponse(
          store,
          store.modelFor(modelName),
          response,
          response.data.id,
          'findRecord'
        ) as never
      );
      return response;
    });
  }
}
