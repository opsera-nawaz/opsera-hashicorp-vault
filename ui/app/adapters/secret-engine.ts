/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationAdapter from './application';
import { encodePath } from 'vault/utils/path-encoding-helpers';
import { splitObject } from 'vault/helpers/split-object';

import type Store from '@ember-data/store';
import type { AdapterModelSchema, AdapterSnapshot, AdapterSerializer } from './-types';

interface MountResponse {
  data?: {
    type?: string;
    options?: { version?: string };
    [key: string]: unknown;
  };
}

export default class SecretEngineAdapter extends ApplicationAdapter {
  url(path?: string): string {
    const url = `${this.buildURL()}/mounts`;
    return path ? url + '/' + encodePath(path) : url;
  }

  urlForConfig(path: string): string {
    return `/v1/${path}/config`;
  }

  internalURL(path?: string): string {
    const urlPrefix = (this as unknown as { urlPrefix: () => string }).urlPrefix();
    let url = `/${urlPrefix}/internal/ui/mounts`;
    if (path) {
      url = `${url}/${encodePath(path)}`;
    }
    return url;
  }

  pathForType(): string {
    return 'mounts';
  }

  // @ts-expect-error - concrete override of RESTAdapter's generic query<K>; this codebase's
  // adapters consistently override with concrete (non-generic) params, and this one is `async`
  // (native Promise) while the base declares `RSVP.Promise` — see app/adapters/-types.ts.
  async query(_store: Store, _type: AdapterModelSchema, query: { path?: string }) {
    let mountModel: MountResponse | undefined;
    let configModel: MountResponse | undefined;
    try {
      mountModel = (await this.ajax(this.internalURL(query.path), 'GET')) as MountResponse;
      if (mountModel?.data?.type === 'kv' && mountModel?.data?.options?.version === '2') {
        configModel = (await this.ajax(this.urlForConfig(query.path as string), 'GET')) as MountResponse;
        mountModel.data = { ...mountModel.data, ...configModel.data };
      }
    } catch (error) {
      // no path means this was an error on listing
      if (!query.path || !mountModel) {
        throw error;
      }
      // control groups will throw a 403 permission denied error. If this happens return the mountModel
      // error is handled on routing
    }
    return mountModel;
  }

  // @ts-expect-error - see query above
  async createRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const serializer = store.serializerFor(type.modelName as never) as AdapterSerializer;
    let data = serializer.serialize(snapshot) as {
      config: Record<string, unknown>;
      type?: string;
      options?: { version?: number };
      id?: string;
      [key: string]: unknown;
    };
    const path = snapshot.attr('path') as string;
    // for kv2 we make two network requests
    data.config['id'] = path; // config relationship needs an id so use path for now
    if (data.type === 'kv' && data.options?.version === 2) {
      // data has both data for sys mount and the config, we need to separate them
      const splitObjects = splitObject(data, ['max_versions', 'delete_version_after', 'cas_required']) as [
        Record<string, unknown>,
        typeof data,
      ];
      let configData;
      [configData, data] = splitObjects;

      if (!data.id) {
        data.id = path;
      }
      // first create the engine
      await this.ajax(this.url(path), 'POST', { data });

      // second post to config
      try {
        await this.ajax(this.urlForConfig(path), 'POST', { data: configData });
      } catch (e) {
        // error here means you do not have update capabilities to config endpoint. If that's the case we show a flash message in the component and continue with the transition.
        // the error is handled by mount-backend-form component which checks capabilities before hitting the save to the adapter.
        // we do not handle the error here because we want the secret-engine to mount successfully and to continue the flow.
      }
      return {
        data: { ...data, path: path + '/', id: path },
      };
    } else {
      return this.ajax(this.url(path), 'POST', { data }).then(() => {
        // ember data doesn't like 204s if it's not a DELETE
        return {
          data: { ...data, path: path + '/', id: path },
        };
      });
    }
  }

  // @ts-expect-error - see query above
  updateRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const { apiPath, options, adapterMethod } = snapshot.adapterOptions as {
      apiPath?: string;
      options?: { isDelete?: boolean };
      adapterMethod?: string;
    };
    if (adapterMethod) {
      return (this as unknown as Record<string, (...args: unknown[]) => unknown>)[adapterMethod]!(
        store,
        type,
        snapshot
      );
    }
    if (apiPath) {
      const serializer = store.serializerFor(type.modelName as never) as AdapterSerializer;
      const data = serializer.serialize(snapshot);
      const path = encodePath(snapshot.id);
      return this.ajax(`/v1/${path}/${apiPath}`, options?.isDelete ? 'DELETE' : 'POST', { data });
    }
    return undefined;
  }
}
