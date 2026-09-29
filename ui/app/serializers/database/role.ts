/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import RESTSerializer from '@ember-data/serializer/rest';

import type Store from '@ember-data/store';
import type { ModelSchema } from 'ember-data'; // eslint-disable-line ember/use-ember-data-rfc-395-imports
import type { AdapterSnapshot } from 'vault/adapters/-types';

interface RolePayload {
  id?: string | number;
  backend?: string;
  type?: string;
  data: {
    keys?: string[];
    staticRoles?: string[];
    db_name?: string;
    creation_statements?: string[];
    revocation_statements?: string[];
    name?: string;
    [key: string]: unknown;
  };
}

export default class DatabaseRoleSerializer extends RESTSerializer {
  primaryKey = 'name';

  normalizeSecrets(payload: RolePayload) {
    if (payload.data.keys && Array.isArray(payload.data.keys)) {
      const roles = payload.data.keys.map((secret) => {
        let type = 'dynamic';
        let path = 'roles';
        if (payload.data.staticRoles?.includes(secret)) {
          type = 'static';
          path = 'static-roles';
        }
        return { name: secret, backend: payload.backend, type, path };
      });
      return roles;
    }
    let path = 'roles';
    if (payload.type === 'static') {
      path = 'static-roles';
    }
    let database: string[] = [];
    if (payload.data.db_name) {
      database = [payload.data.db_name];
    }
    // Copy to singular for MongoDB
    let creation_statement = '';
    let revocation_statement = '';
    if (payload.data.creation_statements) {
      creation_statement = payload.data.creation_statements[0] as string;
    }
    if (payload.data.revocation_statements) {
      revocation_statement = payload.data.revocation_statements[0] as string;
    }
    return {
      id: payload.id,
      backend: payload.backend,
      name: payload.id,
      type: payload.type,
      database,
      path,
      creation_statement,
      revocation_statement,
      ...payload.data,
    };
  }

  normalizeResponse(
    store: Store,
    primaryModelClass: ModelSchema,
    payload: RolePayload,
    id: string | number,
    requestType: string
  ) {
    const nullResponses = ['updateRecord', 'createRecord', 'deleteRecord'];
    // For create/update/delete, pull name and backend from the adapter response payload.
    // For create specifically, snapshot.id is null (id is not pre-set on the record),
    // so the adapter response is the source of truth for the record id.
    const roles = nullResponses.includes(requestType)
      ? { name: payload.data?.name || id, backend: payload.data?.['backend'] || payload.backend }
      : this.normalizeSecrets(payload);
    const { modelName } = primaryModelClass;
    let transformedPayload: Record<string, unknown> = { [modelName]: roles };
    if (requestType === 'queryRecord') {
      transformedPayload = { [modelName]: roles };
    }
    return super.normalizeResponse(store, primaryModelClass, transformedPayload, id, requestType);
  }

  // @ts-expect-error - concrete override of RESTSerializer's generic serializeAttribute<K>; the
  // loose AdapterSnapshot stand-in isn't assignable to Snapshot<K>.
  serializeAttribute(
    snapshot: AdapterSnapshot,
    json: Record<string, unknown>,
    key: string,
    attributes: Record<string, unknown>
  ): void {
    // Don't send values that are undefined
    const record = snapshot.record as { isNew?: boolean };
    if (
      snapshot.attr(key) !== undefined &&
      (record.isNew ||
        (snapshot as unknown as { changedAttributes(): Record<string, unknown> }).changedAttributes()[key])
    ) {
      super.serializeAttribute(snapshot as never, json, key, attributes);
    }
  }

  // @ts-expect-error - concrete override of RESTSerializer's generic serialize<K>; the loose
  // AdapterSnapshot stand-in isn't assignable to Snapshot<K>.
  serialize(snapshot: AdapterSnapshot, requestType?: string) {
    const data = super.serialize(snapshot as never, requestType as never) as Record<string, unknown> & {
      database?: string[];
      creation_statement?: string;
      revocation_statement?: string;
      db_name?: string;
      creation_statements?: string[];
      revocation_statements?: string[];
    };
    if (data.database) {
      const db = data.database[0];
      data.db_name = db;
      delete data.database;
    }
    // This is necessary because the input for MongoDB is a json string
    // rather than an array, so we transpose that here
    if (data.creation_statement) {
      const singleStatement = data.creation_statement;
      data.creation_statements = [singleStatement];
      delete data.creation_statement;
    }
    if (data.revocation_statement) {
      const singleStatement = data.revocation_statement;
      data.revocation_statements = [singleStatement];
      delete data.revocation_statement;
    }

    return data;
  }
}
