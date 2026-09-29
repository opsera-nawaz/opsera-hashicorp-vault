/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationAdapter from './application';

import type Store from '@ember-data/store';
import type { AdapterModelSchema, AdapterSnapshot } from './-types';

export default class PathFilterConfigAdapter extends ApplicationAdapter {
  url(id: string): string {
    return `${this.buildURL()}/replication/performance/primary/paths-filter/${id}`;
  }

  findRecord(_store: Store, _type: AdapterModelSchema, id: string) {
    return this.ajax(this.url(id), 'GET').then((resp: Record<string, unknown>) => {
      resp['id'] = id;
      return resp;
    });
  }

  // @ts-expect-error - see findRecord above
  createRecord(_store: Store, _type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const serializeSnapshot = (this as unknown as { serialize: (snapshot: AdapterSnapshot) => object })
      .serialize;
    return this.ajax(this.url(snapshot.id), 'PUT', {
      data: serializeSnapshot(snapshot),
    });
  }

  // @ts-expect-error - see findRecord above
  updateRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    return this.createRecord(store, type, snapshot);
  }

  // @ts-expect-error - see findRecord above
  deleteRecord(_store: Store, _type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    return this.ajax(this.url(snapshot.id), 'DELETE');
  }
}
