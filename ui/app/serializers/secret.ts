/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { get } from '@ember/object';
import ApplicationSerializer from './application';

import type { AdapterSnapshot } from 'vault/adapters/-types';

interface SecretPayload {
  id?: string;
  backend?: string;
  data?: { keys?: string[]; [key: string]: unknown };
  [key: string]: unknown;
}

export default class SecretSerializer extends ApplicationSerializer {
  secretDataPath = 'data';

  normalizeItems(payload: SecretPayload, requestType?: string): unknown {
    if (
      requestType !== 'queryRecord' &&
      payload.data &&
      payload.data.keys &&
      Array.isArray(payload.data.keys)
    ) {
      // if we have data.keys, it's a list of ids, so we map over that
      // and create objects with id's
      return payload.data.keys.map((secret) => {
        // secrets don't have an id in the response, so we need to concat the full
        // path of the secret here - the id in the payload is added
        // in the adapter after making the request
        let fullSecretPath = payload.id ? payload.id + secret : secret;

        // if there is no path, it's a "top level" secret, so add
        // a unicode space for the id
        // https://github.com/hashicorp/vault/issues/3348
        if (!fullSecretPath) {
          fullSecretPath = ' ';
        }
        return { id: fullSecretPath, backend: payload.backend };
      });
    }
    const path = this.secretDataPath;
    // move response that is the contents of the secret from the dataPath
    // to `secret_data` so it will be `secretData` in the model
    payload['secret_data'] = get(payload, path);
    delete payload[path];

    return payload;
  }

  // @ts-expect-error - concrete override of JSONSerializer's generic serialize<K>; the loose
  // AdapterSnapshot stand-in (see app/adapters/-types.ts) isn't assignable to Snapshot<K>.
  serialize(snapshot: AdapterSnapshot) {
    return snapshot.attr('secretData');
  }
}
