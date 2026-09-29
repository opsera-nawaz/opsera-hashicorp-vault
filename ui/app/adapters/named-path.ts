/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

/**
 * base adapter for resources that are saved to a path whose unique identifier is name
 * save requests are made to the same endpoint and the resource is either created if not found or updated
 * */
import ApplicationAdapter from './application';
import { assert } from '@ember/debug';

import type Store from '@ember-data/store';
import type { AdapterModelSchema, AdapterSnapshot, AdapterSerializer } from './-types';

interface NamedPathQuery {
  paramKey?: string;
  filterFor?: string[];
  allowed_client_id?: string;
  [key: string]: unknown;
}

export default class NamedPathAdapter extends ApplicationAdapter {
  namespace = 'v1';
  saveMethod = 'POST'; // override when extending if PUT is used rather than POST

  _saveRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const { modelName } = type;
    // since the response is empty return the serialized data rather than nothing
    const data = (store.serializerFor(modelName as never) as AdapterSerializer).serialize(snapshot) as Record<
      string,
      unknown
    >;
    const primaryKey = (store.serializerFor(modelName as never) as AdapterSerializer).primaryKey;
    return this.ajax(
      this.urlForUpdateRecord(snapshot.attr('name') as string, modelName as never, snapshot as never),
      this.saveMethod,
      {
        data,
      }
    ).then(() => {
      data[primaryKey] = snapshot.attr(primaryKey);
      return data;
    });
  }

  // create does not return response similar to PUT request
  // @ts-expect-error - concrete override of RESTAdapter's generic createRecord<K>; this codebase's
  // adapters consistently override with concrete (non-generic) params, see app/adapters/-types.ts.
  createRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const { modelName } = type;
    const name = snapshot.attr('name');
    // throw error if user attempts to create a record with same name, otherwise POST request silently overrides (updates) the existing model
    if (store.peekRecord(modelName as never, name as string) !== null) {
      throw new Error(`A record already exists with the name: ${name}`);
    } else {
      return this._saveRecord(store, type, snapshot);
    }
  }

  // update uses same endpoint and method as create
  // @ts-expect-error - see createRecord above
  updateRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    return this._saveRecord(store, type, snapshot);
  }

  // if backend does not return name in response Ember Data will throw an error for pushing a record with no id
  // use the id (name) supplied to findRecord to set property on response data
  // @ts-expect-error - concrete override of RESTAdapter's generic findRecord<K>; this codebase's
  // adapters consistently override with concrete (non-generic) params.
  findRecord(store: Store, type: AdapterModelSchema, name: string, snapshot: AdapterSnapshot) {
    return super
      .findRecord(store, type as never, name, snapshot as never)
      .then((resp: { data: { name?: string } }) => {
        if (!resp.data.name) {
          resp.data.name = name;
        }
        return resp;
      });
  }

  // GET request with list=true as query param
  // @ts-expect-error - concrete override of RESTAdapter's generic query<K>; this codebase's
  // adapters consistently override with concrete (non-generic) params.
  async query(store: Store, type: AdapterModelSchema, query: NamedPathQuery) {
    const url = this.urlForQuery(query, type.modelName as never);
    const { paramKey, filterFor, allowed_client_id } = query;
    // * 'paramKey' is a string of the param name (model attr) we're filtering for, e.g. 'client_id'
    // * 'filterFor' is an array of values to filter for (value type must match the attr type), e.g. array of ID strings
    // * 'allowed_client_id' is a valid query param to the /provider endpoint
    const queryParams = { list: true, ...(allowed_client_id && { allowed_client_id }) };
    const response = (await this.ajax(url, 'GET', { data: queryParams })) as {
      data: { key_info?: Record<string, Record<string, unknown>> };
    };

    // filter LIST response only if key_info exists and query includes both 'paramKey' & 'filterFor'
    if (filterFor) assert('filterFor must be an array', Array.isArray(filterFor));
    if (response.data.key_info && filterFor && paramKey && !filterFor.includes('*')) {
      const data = this.filterListResponse(paramKey, filterFor, response.data.key_info);
      return { ...response, data };
    }
    return response;
  }

  filterListResponse(
    paramKey: string,
    matchValues: string[],
    key_info: Record<string, Record<string, unknown>>
  ) {
    const keyInfoAsArray = Object.entries(key_info);
    const filtered = keyInfoAsArray.filter((key) => {
      const value = key[1]; // value is an object of model attributes
      return matchValues.includes(value[paramKey] as string);
    });
    const filteredKeyInfo = Object.fromEntries(filtered);
    const filteredKeys = Object.keys(filteredKeyInfo);
    return { keys: filteredKeys, key_info: filteredKeyInfo };
  }
}
