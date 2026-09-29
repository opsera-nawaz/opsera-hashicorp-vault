/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationAdapter from './application';
import { service } from '@ember/service';
import { sanitizePath } from 'core/utils/sanitize-path';
import { encodePath } from 'vault/utils/path-encoding-helpers';
import { tracked } from '@glimmer/tracking';
import { getOwner } from '@ember/owner';

import type StoreService from '@ember-data/store';
import type { AdapterModelSchema, AdapterSnapshot } from './-types';

interface AdapterPaths {
  getPath?: string;
  createPath?: string;
  deletePath?: string;
}

export default class GeneratedItemListAdapter extends ApplicationAdapter {
  @service declare store: StoreService;
  namespace = 'v1';

  // these items are set by calling getNewAdapter in the path-help service.
  @tracked apiPath = '';
  paths: AdapterPaths = {};

  // These are the paths used for the adapter actions
  get getPath(): string {
    return this.paths.getPath || '';
  }
  get createPath(): string {
    return this.paths.createPath || '';
  }
  get deletePath(): string {
    return this.paths.deletePath || '';
  }

  getDynamicApiPath(): string {
    const route = getOwner(this)?.lookup('route:vault.cluster.access.method') as {
      modelFor: (name: string) => { apiPath: string };
    };
    const result = route.modelFor('vault.cluster.access.method');
    this.apiPath = result.apiPath;
    return result.apiPath;
  }

  async fetchByQuery(_store: StoreService, query: { id: string }, isList?: boolean) {
    const { id } = query;
    const payload: { list?: boolean } = {};
    if (isList) {
      payload.list = true;
    }
    const path = isList ? this.getDynamicApiPath() : '';

    const resp = (await this.ajax(this.urlForItem(id, isList, path), 'GET', { data: payload })) as object;
    const data = {
      id,
      method: id,
    };
    return { ...resp, ...data };
  }

  // @ts-expect-error - concrete override of RESTAdapter's generic query<K>; this codebase's
  // adapters consistently override with concrete (non-generic) params, see app/adapters/-types.ts.
  query(store: StoreService, _type: AdapterModelSchema, query: { id: string }) {
    return this.fetchByQuery(store, query, true);
  }

  // @ts-expect-error - see query above
  queryRecord(store: StoreService, _type: AdapterModelSchema, query: { id: string }) {
    return this.fetchByQuery(store, query);
  }

  urlForItem(id: string, isList?: boolean, dynamicApiPath?: string): string {
    const itemType = sanitizePath(this.getPath);
    let url;
    const encodedId = encodePath(id);
    // the apiPath changes when you switch between routes but the apiPath variable does not unless the model is reloaded
    // overwrite apiPath if dynamicApiPath exist.
    // dynamicApiPath comes from the model->adapter
    let apiPath = this.apiPath;
    if (dynamicApiPath) {
      apiPath = dynamicApiPath;
    }
    // isList indicates whether we are viewing the list page
    // of a top-level item such as userpass
    if (isList) {
      url = `${this.buildURL()}/${apiPath}${itemType}/`;
    } else {
      // build the URL for the show page of a nested item
      // such as a userpass group
      url = `${this.buildURL()}/${apiPath}${itemType}/${encodedId}`;
    }

    return url;
  }

  urlForQueryRecord(id: string, modelName: string): string {
    // preserves the original (likely accidental) call shape: `modelName` lands in the `isList`
    // position, not `dynamicApiPath` — kept as-is since this is a type-only conversion.
    return this.urlForItem(id, modelName as unknown as boolean);
  }

  urlForUpdateRecord(id: string): string {
    const itemType = this.createPath.slice(1, this.createPath.indexOf('{') - 1);
    return `${this.buildURL()}/${this.apiPath}${itemType}/${id}`;
  }

  // @ts-expect-error - see urlForQueryRecord above
  urlForCreateRecord(modelType: string, snapshot: AdapterSnapshot): string {
    const id = (snapshot.record as unknown as { mutableId: string }).mutableId; // computed property that returns either id or private settable _id value
    const path = this.createPath.slice(1, this.createPath.indexOf('{') - 1);
    return `${this.buildURL()}/${this.apiPath}${path}/${id}`;
  }

  urlForDeleteRecord(id: string): string {
    const path = this.deletePath.slice(1, this.deletePath.indexOf('{') - 1);
    return `${this.buildURL()}/${this.apiPath}${path}/${id}`;
  }

  // @ts-expect-error - see urlForQueryRecord above
  createRecord(store: StoreService, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    return super
      .createRecord(store, type as never, snapshot as never)
      .then((response: { id?: string } | undefined) => {
        // if the server does not return an id and one has not been set on the model we need to set it manually from the mutableId value
        const record = snapshot.record as unknown as { id?: string; mutableId: string };
        if (!response?.id && !record.id) {
          record.id = record.mutableId;
          snapshot.id = record.id;
        }
        return response;
      });
  }
}
