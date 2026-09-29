/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationAdapter from './application';

import type Store from '@ember-data/store';
import type { AdapterModelSchema } from './-types';

export default class ControlGroupAdapter extends ApplicationAdapter {
  pathForType(): string {
    return 'control-group';
  }

  findRecord(_store: Store, type: AdapterModelSchema, id: string) {
    const baseUrl = this.buildURL(type.modelName as never);
    return this.ajax(`${baseUrl}/request`, 'POST', {
      data: {
        accessor: id,
      },
    }).then((response: Record<string, unknown>) => {
      response['id'] = id;
      return response;
    });
  }

  // @ts-expect-error - concrete override of RESTAdapter's generic urlForUpdateRecord<K>; this
  // codebase's adapters consistently override with concrete (non-generic) params.
  urlForUpdateRecord(id: string, modelName: string): string {
    const base = this.buildURL(modelName as never);
    return `${base}/authorize`;
  }
}
