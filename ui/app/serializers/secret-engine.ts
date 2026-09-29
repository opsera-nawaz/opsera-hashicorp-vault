/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationSerializer from './application';
import { EmbeddedRecordsMixin } from '@ember-data/serializer/rest';
import engineDisplayData from 'vault/helpers/engines-display-data';

import type Store from '@ember-data/store';
import type { ModelSchema } from 'ember-data'; // eslint-disable-line ember/use-ember-data-rfc-395-imports
import type { AdapterSnapshot } from 'vault/adapters/-types';

// `_super` is provided by Ember's classic `.extend()` method wrapping at runtime, but the
// `.extend(Mixin, hash)` overload used below doesn't expose it on the hash's inferred `this`
// type, so calls to it are cast through this minimal shape instead.
interface HasSuper {
  _super(...args: unknown[]): unknown;
}

interface SecretEngineConfigData {
  id?: string;
  uuid?: string;
  [key: string]: unknown;
}

interface SecretEngineData {
  config?: SecretEngineConfigData;
  uuid?: string;
  version?: unknown;
  options?: { version?: unknown };
  [key: string]: unknown;
}

interface SecretEngineBackend {
  path?: string;
  id?: string;
  data?: Record<string, unknown>;
  options?: { version?: string | number };
  type?: string;
  [key: string]: unknown;
}

interface SecretEnginePayload {
  data: {
    path?: string;
    secret?: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// `EmbeddedRecordsMixin` mixes new prototype methods onto the serializer at runtime the same way
// it always has; `.extend()` (rather than native `class ... extends`) is kept here for the same
// reason documented in app/serializers/identity/entity.ts: `@types/ember-data` models the mixin
// as a plain class rather than an `Ember.Mixin<T, B>`, which breaks native-class static-side
// inference when composed with a further subclass.
export default ApplicationSerializer.extend(EmbeddedRecordsMixin, {
  attrs: {
    config: { embedded: 'always' },
  },

  normalize(modelClass: ModelSchema, data: SecretEngineData): {} {
    // embedded records need a unique value to be stored
    // set id for config to uuid of secret engine
    if (data.config && !data.config.id) {
      data.config.id = data.uuid;
    }
    // move version out of options so it can be defined on secret-engine model
    data['version'] = data.options ? data.options.version : null;
    return (this as unknown as HasSuper)._super(modelClass, data) as {};
  },

  normalizeBackend(path: string | null, backend: SecretEngineBackend): SecretEngineBackend {
    let struct: SecretEngineBackend = {};
    for (const attribute in backend) {
      struct[attribute] = backend[attribute];
    }
    // queryRecord adds path to the response
    if (path !== null && !struct.path) {
      struct.path = path;
    }

    if (struct.data) {
      struct = { ...struct, ...struct.data };
      delete struct.data;
    }
    // strip the trailing slash off of the path so we
    // can navigate to it without getting `//` in the url
    struct.id = struct.path?.slice(0, -1);

    if (backend?.type === 'kv' && !backend?.options?.version) {
      // enabling kv in the CLI without a version flag mounts a v1 engine
      // however, when no version is specified the options key is null
      // we explicitly set v1 here, otherwise v2 is pulled from the ember model default
      struct.options = { version: '1', ...struct.options };
    }
    return struct;
  },

  normalizeResponse(
    store: Store,
    primaryModelClass: ModelSchema,
    payload: SecretEnginePayload,
    id: string | number,
    requestType: string
  ): {} {
    const isCreate = requestType === 'createRecord';
    const isFind = requestType === 'findRecord';
    const isQueryRecord = requestType === 'queryRecord';
    let backends;
    if (isCreate) {
      backends = payload.data;
    } else if (isFind) {
      backends = this.normalizeBackend(`${id}/`, payload.data);
    } else if (isQueryRecord) {
      backends = this.normalizeBackend(null, payload);
    } else {
      // this is terrible, I'm sorry
      // TODO extract AWS and SSH config saving from the secret-engine model to simplify this
      if (payload.data.secret) {
        const secret = payload.data.secret;
        backends = Object.keys(secret).map((secretId) => this.normalizeBackend(secretId, secret[secretId]!));
      } else if (!payload.data.path) {
        const data = payload.data as Record<string, SecretEngineBackend>;
        backends = Object.keys(payload.data).map((backendId) =>
          this.normalizeBackend(backendId, data[backendId]!)
        );
      } else {
        backends = [this.normalizeBackend(payload.data.path, payload.data)];
      }
    }

    return (this as unknown as HasSuper)._super(store, primaryModelClass, backends, id, requestType) as {};
  },

  serialize(snapshot: AdapterSnapshot) {
    const type = (snapshot.record as { engineType?: string }).engineType;
    const data = (this as unknown as HasSuper)._super(snapshot) as {
      options: { version?: number | string; identity_token_key?: string };
      version?: unknown;
      config?: { identity_token_key?: string };
      max_versions?: unknown;
      cas_required?: unknown;
      delete_version_after?: unknown;
    };
    // move version back to options
    data.options = data.version ? { version: data.version as string | number } : {};
    delete data.version;

    if (!engineDisplayData(type ?? '')?.isWIF) {
      // only send identity_token_key if it's set on a WIF secret engine.
      // because of issues with the model unloading with a belongsTo relationships
      // identity_token_key can accidentally carry over if a user backs out of the form and changes the type from WIF to non-WIF.
      delete data.config?.identity_token_key;
    }

    if (type !== 'kv' || data.options.version === 1) {
      // These items are on the model, but used by the kv-v2 config endpoint only
      delete data.max_versions;
      delete data.cas_required;
      delete data.delete_version_after;
    }
    // only KV uses options
    if (type !== 'kv' && type !== 'generic') {
      delete (data as { options?: unknown }).options;
    } else if (!data.options.version) {
      // if options.version isn't set for some reason
      // default to 2
      data.options.version = 2;
    }
    return data;
  },
});
