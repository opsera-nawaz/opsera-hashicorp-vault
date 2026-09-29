/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import JSONSerializer from '@ember-data/serializer/json';
import { isNone, isBlank } from '@ember/utils';
import { decamelize } from '@ember/string';

import type Store from '@ember-data/store';
import type { ModelSchema } from 'ember-data'; // eslint-disable-line ember/use-ember-data-rfc-395-imports
import type { AdapterSnapshot } from 'vault/adapters/-types';

interface NormalizeItemsPayload {
  data?: { keys?: unknown[]; [key: string]: unknown };
  _requestQuery?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ModelClassWithCapabilities {
  relatedCapabilities?: (jsonApi: unknown) => unknown;
}

export default class ApplicationSerializer extends JSONSerializer {
  keyForAttribute(attr: string): string {
    return decamelize(attr);
  }

  normalizeItems(payload: NormalizeItemsPayload): unknown {
    if (payload.data && payload.data.keys && Array.isArray(payload.data.keys)) {
      const models = payload.data.keys.map((key) => {
        if (typeof key !== 'string') {
          return key;
        }
        const pk = this.primaryKey || 'id';
        let model: Record<string, unknown> = { [pk]: key };
        // if we've added _requestQuery in the adapter, we want
        // attach it to the individual models
        if (payload._requestQuery) {
          model = { ...model, ...payload._requestQuery };
        }
        return model;
      });
      return models;
    }
    Object.assign(payload, payload.data);
    delete payload.data;
    return payload;
  }

  pushPayload(store: Store, payload: { modelName: string; id: string; [key: string]: unknown }) {
    const transformedPayload = this.normalizeResponse(
      store,
      store.modelFor(payload.modelName as never),
      payload,
      payload.id,
      'findRecord'
    );
    return store.push(transformedPayload);
  }

  normalizeResponse(
    store: Store,
    primaryModelClass: ModelSchema,
    payload: NormalizeItemsPayload,
    id: string | number,
    requestType: string
  ) {
    const responseJSON = this.normalizeItems(payload) as
      | { id?: string | number }
      | { id?: string | number }[];
    delete payload._requestQuery;
    if (id && !Array.isArray(responseJSON) && !responseJSON.id) {
      responseJSON.id = id;
    }
    let jsonAPIRepresentation = super.normalizeResponse(
      store,
      primaryModelClass,
      responseJSON,
      id,
      requestType
    );
    const modelClass = primaryModelClass as unknown as ModelClassWithCapabilities;
    if (modelClass.relatedCapabilities) {
      jsonAPIRepresentation = modelClass.relatedCapabilities(jsonAPIRepresentation) as {};
    }
    return jsonAPIRepresentation;
  }

  // @ts-expect-error - concrete override of JSONSerializer's generic serializeAttribute<K>; the
  // loose AdapterSnapshot stand-in (see app/adapters/-types.ts) isn't assignable to Snapshot<K>.
  serializeAttribute(
    snapshot: AdapterSnapshot,
    json: Record<string, unknown>,
    key: string,
    attributes: { options: { readOnly?: boolean } }
  ): void {
    const val = snapshot.attr(key);
    const valHasNotChanged = isNone(
      (snapshot as unknown as { changedAttributes(): Record<string, unknown> }).changedAttributes()[key]
    );
    const valIsBlank = isBlank(val);
    if (attributes.options.readOnly) {
      return;
    }
    if (valIsBlank && valHasNotChanged) {
      return;
    }

    super.serializeAttribute(snapshot as never, json, key, attributes);
  }

  serializeBelongsTo(_snapshot: unknown, json: unknown) {
    return json;
  }
}
