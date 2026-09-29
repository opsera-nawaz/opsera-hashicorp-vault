/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import RESTSerializer, { EmbeddedRecordsMixin } from '@ember-data/serializer/rest';
import { decamelize } from '@ember/string';

import type Store from '@ember-data/store';
import type { ModelSchema } from 'ember-data'; // eslint-disable-line ember/use-ember-data-rfc-395-imports

// `_super` is provided by Ember's classic `.extend()` method wrapping at runtime, but the
// `.extend(Mixin, hash)` overload used below doesn't expose it on the hash's inferred `this`
// type, so calls to it are cast through this minimal shape instead.
interface HasSuper {
  _super(...args: unknown[]): unknown;
}

interface NodePayload {
  nodes?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

// `EmbeddedRecordsMixin` mixes new prototype methods onto the serializer at runtime the same way
// it always has; `.extend()` (rather than native `class ... extends`) is kept here for the same
// reason documented in app/serializers/identity/entity.ts: `@types/ember-data` models the mixin
// as a plain class rather than an `Ember.Mixin<T, B>`, which breaks native-class static-side
// inference when composed with a further subclass.
export default RESTSerializer.extend(EmbeddedRecordsMixin, {
  keyForAttribute: function (attr: string): string {
    return decamelize(attr);
  },

  pushPayload(store: Store, payload: NodePayload): unknown {
    const transformedPayload = this.normalizeResponse(
      store,
      store.modelFor('node' as never),
      payload,
      null,
      'findAll'
    );
    return store.push(transformedPayload);
  },

  nodeFromObject(name: string, payload: NodePayload): Record<string, unknown> {
    const nodeObj = payload.nodes![name]!;
    return Object.assign(nodeObj, {
      name,
      id: name,
    });
  },

  normalizeResponse(
    store: Store,
    primaryModelClass: ModelSchema,
    payload: NodePayload,
    id: string | number | null,
    requestType: string
  ): {} {
    const nodes = payload.nodes
      ? Object.keys(payload.nodes).map((name) => this.nodeFromObject(name, payload))
      : [Object.assign(payload, { id: '1' })];

    const transformedPayload = { nodes: nodes };

    return (this as unknown as HasSuper)._super(
      store,
      primaryModelClass,
      transformedPayload,
      id,
      requestType
    ) as {};
  },

  normalize(model: ModelSchema, hash: Record<string, unknown>, prop: string): {} {
    hash['id'] = '1';
    return (this as unknown as HasSuper)._super(model, hash, prop) as {};
  },
});
