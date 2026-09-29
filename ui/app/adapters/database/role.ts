/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { assert } from '@ember/debug';
import ControlGroupError from 'vault/lib/control-group-error';
import ApplicationAdapter from '../application';
import { allSettled } from 'rsvp';
import { addToArray } from 'vault/helpers/add-to-array';
import { removeFromArray } from 'vault/helpers/remove-from-array';

import type Store from '@ember-data/store';
import type { AdapterModelSchema, AdapterSnapshot, AdapterSerializer } from '../-types';

interface RoleResponse {
  data: { keys?: string[]; [key: string]: unknown };
  [key: string]: unknown;
}

interface DatabaseConnectionRecord {
  allowed_roles?: string[];
  save(): Promise<unknown>;
}

interface AdapterHttpError {
  httpStatus?: number;
  errors?: string[];
}

export default class DatabaseRoleAdapter extends ApplicationAdapter {
  namespace = 'v1';
  pathForType(): string {
    assert('Generate the url dynamically based on role type', false);
    // `assert` is a no-op in production builds, matching the original JS's implicit `undefined` return.
    return undefined as unknown as string;
  }

  urlFor(backend: string, id?: string, type = 'dynamic'): string {
    let role = 'roles';
    if (type === 'static') {
      role = 'static-roles';
    }
    let url = `${this.buildURL()}/${backend}/${role}`;
    if (id) {
      url = `${this.buildURL()}/${backend}/${role}/${id}`;
    }
    return url;
  }

  staticRoles(backend: string, id?: string) {
    return this.ajax(this.urlFor(backend, id, 'static'), 'GET', this.optionsForQuery(id)).then(
      (resp: RoleResponse) => {
        if (id) {
          return {
            ...resp,
            type: 'static',
            backend,
            id,
          };
        }
        return resp;
      }
    );
  }

  dynamicRoles(backend: string, id?: string) {
    return this.ajax(this.urlFor(backend, id), 'GET', this.optionsForQuery(id)).then((resp: RoleResponse) => {
      if (id) {
        return {
          ...resp,
          type: 'dynamic',
          backend,
          id,
        };
      }
      return resp;
    });
  }

  optionsForQuery(id?: string) {
    const data: Record<string, unknown> = {};
    if (!id) {
      data['list'] = true;
    }
    return { data };
  }

  queryRecord(
    _store: Store,
    _type: AdapterModelSchema,
    query: { backend: string; id?: string; type?: string }
  ) {
    const { backend, id } = query;

    if (query.type === 'static') {
      return this.staticRoles(backend, id);
    } else if (query?.type === 'dynamic') {
      return this.dynamicRoles(backend, id);
    }
    // if role type is not defined, try both
    return allSettled([this.staticRoles(backend, id), this.dynamicRoles(backend, id)]).then(
      ([staticResp, dynamicResp]) => {
        if (staticResp.state === 'rejected' && dynamicResp.state === 'rejected') {
          let reason = staticResp.reason as AdapterHttpError;
          const dynamicReason = dynamicResp.reason as AdapterHttpError;
          if (dynamicResp.reason instanceof ControlGroupError) {
            throw dynamicResp.reason;
          }
          if ((reason?.httpStatus ?? 0) < (dynamicReason?.httpStatus ?? 0)) {
            reason = dynamicReason;
          }
          throw reason;
        }
        // Names are distinct across both types of role,
        // so only one request should ever come back with value
        const staticValue = (staticResp as { value?: RoleResponse }).value;
        const dynamicValue = (dynamicResp as { value?: RoleResponse }).value;
        const type = staticValue ? 'static' : 'dynamic';
        const successful = staticValue || dynamicValue;
        const resp: { data: Record<string, unknown>; backend: string; id?: string; type: string } = {
          data: {},
          backend,
          id,
          type,
        };

        resp.data = { ...successful?.data };

        return resp;
      }
    );
  }

  query(_store: Store, _type: AdapterModelSchema, query: { backend: string }) {
    const { backend } = query;
    const staticReq = this.staticRoles(backend);
    const dynamicReq = this.dynamicRoles(backend);

    return allSettled([staticReq, dynamicReq]).then(([staticResp, dynamicResp]) => {
      const resp: { backend: string; data: Record<string, unknown> } = {
        backend,
        data: { keys: [] },
      };

      if (staticResp.state === 'rejected' && dynamicResp.state === 'rejected') {
        // both failed, throw error
        throw dynamicResp.reason;
      }
      // at least one request has data
      let staticRoles: string[] = [];
      let dynamicRoles: string[] = [];

      const staticValue = (staticResp as { value?: RoleResponse }).value;
      const dynamicValue = (dynamicResp as { value?: RoleResponse }).value;
      if (staticValue) {
        staticRoles = staticValue.data.keys ?? [];
      }
      if (dynamicValue) {
        dynamicRoles = dynamicValue.data.keys ?? [];
      }

      resp.data = {
        ...resp.data,
        keys: [...staticRoles, ...dynamicRoles],
        backend,
        staticRoles,
        dynamicRoles,
      };

      return resp;
    });
  }

  async _updateAllowedRoles(
    store: Store,
    { role, backend, db, type = 'add' }: { role: string; backend: string; db: string; type?: string }
  ) {
    const connection = (await store.queryRecord('database/connection', {
      backend,
      id: db,
    })) as unknown as DatabaseConnectionRecord;
    const roles = [...(connection.allowed_roles || [])];
    const allowedRoles = type === 'add' ? addToArray(roles, role) : removeFromArray(roles, role);
    connection.allowed_roles = allowedRoles;
    return connection.save();
  }

  // @ts-expect-error - concrete override of RESTAdapter's generic createRecord<K>; this codebase's
  // adapters consistently override with concrete (non-generic) params, and this one is `async`
  // (native Promise) while the base declares `RSVP.Promise`.
  async createRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const serializer = store.serializerFor(type.modelName as never) as AdapterSerializer;
    const data = serializer.serialize(snapshot);
    const roleType = snapshot.attr('type') as string;
    const backend = snapshot.attr('backend') as string;
    const id = snapshot.attr('name') as string;
    const db = snapshot.attr('database') as string[];
    try {
      await this._updateAllowedRoles(store, {
        role: id,
        backend,
        db: db[0] as string,
      });
    } catch (e) {
      this.checkError(e as AdapterHttpError);
    }

    return this.ajax(this.urlFor(backend, id, roleType), 'POST', { data }).then(() => {
      // ember data doesn't like 204s if it's not a DELETE
      return {
        data: { name: id, backend },
      };
    });
  }

  // @ts-expect-error - see createRecord above
  async deleteRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const roleType = snapshot.attr('type') as string;
    const backend = snapshot.attr('backend') as string;
    const id = snapshot.attr('name') as string;
    const db = snapshot.attr('database') as string[];
    try {
      await this._updateAllowedRoles(store, {
        role: id,
        backend,
        db: db[0] as string,
        type: 'remove',
      });
    } catch (e) {
      this.checkError(e as AdapterHttpError);
    }

    return this.ajax(this.urlFor(backend, id, roleType), 'DELETE');
  }

  // @ts-expect-error - see createRecord above
  async updateRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const serializer = store.serializerFor(type.modelName as never) as AdapterSerializer;
    const serializedData = serializer.serialize(snapshot) as Record<string, unknown>;
    const roleType = snapshot.attr('type') as string;
    const backend = snapshot.attr('backend') as string;
    const id = snapshot.attr('name') as string;
    let data: Record<string, unknown> = {};
    if (roleType === 'static') {
      data = {
        ...serializedData,
        username: snapshot.attr('username'), // username is required for updating a static role
      };
    } else {
      data = serializedData;
    }

    return this.ajax(this.urlFor(backend, id, roleType), 'POST', { data }).then(() => data);
  }

  checkError(e: AdapterHttpError): void {
    if (e.httpStatus === 403) {
      // The user does not have the permission to update the connection. This
      // can happen if their permissions are limited to the role. In that case
      // we ignore the error and continue updating the role.
      return;
    }
    throw new Error(`Could not update allowed roles for selected database: ${(e.errors ?? []).join(', ')}`);
  }
}
