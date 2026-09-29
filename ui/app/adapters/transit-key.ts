/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationAdapter from './application';
import { pluralize } from 'ember-inflector';
import { encodePath } from 'vault/utils/path-encoding-helpers';

import type Store from '@ember-data/store';
import type { AdapterModelSchema, AdapterSnapshot, AdapterSerializer } from './-types';

interface KeyActionPayload {
  param?: unknown;
  [key: string]: unknown;
}

export default class TransitKeyAdapter extends ApplicationAdapter {
  namespace = 'v1';

  createOrUpdate(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot, requestType?: string) {
    const serializer = store.serializerFor(type.modelName as never) as AdapterSerializer;
    const data = serializer.serialize(snapshot, requestType);
    const name = snapshot.attr('name') as string;
    let url = this.urlForSecret((snapshot.record as unknown as { backend: string }).backend, name);
    if (requestType === 'update') {
      url = url + '/config';
    }

    return this.ajax(url, 'POST', { data }).then((resp: Record<string, unknown> | undefined) => {
      const response: Record<string, unknown> = resp || {};
      response['id'] = name;
      return response;
    });
  }

  // @ts-expect-error - concrete override of RESTAdapter's generic createRecord<K>; this codebase's
  // adapters consistently override with concrete (non-generic) params, see app/adapters/-types.ts.
  createRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    return this.createOrUpdate(store, type, snapshot);
  }

  // @ts-expect-error - see createRecord above
  updateRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    return this.createOrUpdate(store, type, snapshot, 'update');
  }

  // @ts-expect-error - see createRecord above
  deleteRecord(_store: Store, _type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const { id } = snapshot;
    return this.ajax(
      this.urlForSecret((snapshot.record as unknown as { backend: string }).backend, id),
      'DELETE'
    );
  }

  pathForType(type: string): string {
    let path;
    switch (type) {
      case 'cluster':
        path = 'clusters';
        break;
      case 'secret-engine':
        path = 'secrets';
        break;
      default:
        path = pluralize(type);
        break;
    }
    return path;
  }

  urlForSecret(backend: string, id?: string): string {
    let url = `${this.buildURL()}/${encodePath(backend)}/keys/`;
    if (id) {
      url += encodePath(id);
    }
    return url;
  }

  urlForAction(action: string, backend: string, id: string, param?: unknown): string {
    const urlBase = `${this.buildURL()}/${encodePath(backend)}/${action}`;
    // these aren't key-specific
    if (action === 'hash' || action === 'random') {
      return urlBase;
    }
    if (action === 'datakey' && param) {
      // datakey action has `wrapped` or `plaintext` as part of the url
      return `${urlBase}/${param}/${encodePath(id)}`;
    }
    if (action === 'export' && param) {
      const [type, version] = param as [string, string | undefined];
      const exportBase = `${urlBase}/${type}-key/${encodePath(id)}`;
      return version ? `${exportBase}/${version}` : exportBase;
    }
    return `${urlBase}/${encodePath(id)}`;
  }

  optionsForQuery(id?: string) {
    const data: Record<string, unknown> = {};
    if (!id) {
      data['list'] = true;
    }
    return { data };
  }

  fetchByQuery(query: { id?: string; backend: string }) {
    const { id, backend } = query;
    return this.ajax(this.urlForSecret(backend, id), 'GET', this.optionsForQuery(id)).then(
      (resp: Record<string, unknown>) => {
        resp['id'] = id;
        resp['backend'] = backend;
        return resp;
      }
    );
  }

  query(_store: Store, _type: AdapterModelSchema, query: { id?: string; backend: string }) {
    return this.fetchByQuery(query);
  }

  queryRecord(_store: Store, _type: AdapterModelSchema, query: { id?: string; backend: string }) {
    return this.fetchByQuery(query);
  }

  // rotate, encrypt, decrypt, sign, verify, hmac, rewrap, datakey
  keyAction(
    action: string,
    { backend, id, payload }: { backend: string; id: string; payload: KeyActionPayload },
    options: { wrapTTL?: string } = {}
  ) {
    const verb = action === 'export' ? 'GET' : 'POST';
    const { wrapTTL } = options;
    if (action === 'rotate') {
      return this.ajax(this.urlForSecret(backend, id) + '/rotate', verb);
    }
    const { param } = payload;

    delete payload.param;
    return this.ajax(this.urlForAction(action, backend, id, param), verb, {
      data: payload,
      wrapTTL,
    });
  }
}
