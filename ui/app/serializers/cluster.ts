/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import RESTSerializer, { EmbeddedRecordsMixin } from '@ember-data/serializer/rest';
import { decamelize } from '@ember/string';
import IdentityManager from '../utils/identity-manager';

import type Store from '@ember-data/store';
import type { ModelSchema } from 'ember-data'; // eslint-disable-line ember/use-ember-data-rfc-395-imports

const uuids = new IdentityManager();

interface ReplicationLikeData {
  id?: string;
  cluster_id?: string;
  [key: string]: unknown;
}

// `_super` is provided by Ember's classic `.extend()` method wrapping at runtime, but the
// `.extend(Mixin, hash)` overload used below doesn't expose it on the hash's inferred `this`
// type, so calls to it are cast through this minimal shape instead.
interface HasSuper {
  _super(...args: unknown[]): unknown;
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

  attrs: {
    nodes: { embedded: 'always' },
    dr: { embedded: 'always' },
    performance: { embedded: 'always' },
  },

  setReplicationId(data?: ReplicationLikeData): void {
    if (data) {
      data.id = data.cluster_id || uuids.fetch();
    }
  },

  normalize(
    modelClass: ModelSchema,
    data: { dr?: ReplicationLikeData; performance?: ReplicationLikeData }
  ): {} {
    // embedded records need a unique value to be stored
    // set id for dr and performance to cluster_id or random unique id
    this.setReplicationId(data.dr);
    this.setReplicationId(data.performance);
    return (this as unknown as HasSuper)._super(modelClass, data) as {};
  },

  pushPayload(store: Store, payload: Record<string, unknown>): unknown {
    const transformedPayload = this.normalizeResponse(
      store,
      store.modelFor('cluster' as never),
      payload,
      null,
      'findAll'
    );
    return store.push(transformedPayload);
  },

  normalizeResponse(
    store: Store,
    primaryModelClass: ModelSchema,
    payload: { data?: Record<string, unknown>; [key: string]: unknown },
    id: string | number | null,
    requestType: string
  ): {} {
    // FIXME when multiple clusters lands
    const transformedPayload = {
      clusters: Object.assign({ id: '1' }, payload.data || payload),
    };

    return (this as unknown as HasSuper)._super(
      store,
      primaryModelClass,
      transformedPayload,
      id,
      requestType
    ) as {};
  },
});
