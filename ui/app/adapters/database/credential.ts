/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { allSettled } from 'rsvp';
import ApplicationAdapter from '../application';
import ControlGroupError from 'vault/lib/control-group-error';

import type Store from '@ember-data/store';
import type { AdapterModelSchema } from '../-types';

interface CredentialQuery {
  backend: string;
  secret: string;
  roleType?: string;
}

interface RejectedReason {
  httpStatus?: number;
  [key: string]: unknown;
}

export default class DatabaseCredentialAdapter extends ApplicationAdapter {
  namespace = 'v1';

  _staticCreds(backend: string, secret: string) {
    return this.ajax(
      `${this.buildURL()}/${encodeURIComponent(backend)}/static-creds/${encodeURIComponent(secret)}`,
      'GET'
    ).then((resp: object) => ({ ...resp, roleType: 'static' }));
  }

  _dynamicCreds(backend: string, secret: string) {
    return this.ajax(
      `${this.buildURL()}/${encodeURIComponent(backend)}/creds/${encodeURIComponent(secret)}`,
      'GET'
    ).then((resp: object) => ({ ...resp, roleType: 'dynamic' }));
  }

  fetchByQuery(_store: Store, query: CredentialQuery) {
    const { backend, secret } = query;
    if (query.roleType === 'static') {
      return this._staticCreds(backend, secret);
    } else if (query.roleType === 'dynamic') {
      return this._dynamicCreds(backend, secret);
    }
    return allSettled([this._staticCreds(backend, secret), this._dynamicCreds(backend, secret)]).then(
      ([staticResp, dynamicResp]) => {
        if (staticResp.state === 'rejected' && dynamicResp.state === 'rejected') {
          let reason = staticResp.reason as RejectedReason;
          const dynamicReason = dynamicResp.reason as RejectedReason;
          if (dynamicResp.reason instanceof ControlGroupError) {
            throw dynamicResp.reason;
          }
          if ((reason?.httpStatus ?? 0) < (dynamicReason?.httpStatus ?? 0)) {
            reason = dynamicReason;
          }
          throw reason;
        }
        // Otherwise, return whichever one has a value
        const staticValue = (staticResp as { value?: unknown }).value;
        const dynamicValue = (dynamicResp as { value?: unknown }).value;
        return staticValue || dynamicValue;
      }
    );
  }

  queryRecord(store: Store, _type: AdapterModelSchema, query: CredentialQuery) {
    return this.fetchByQuery(store, query);
  }

  rotateRoleCredentials(backend: string, id: string) {
    return this.ajax(
      `${this.buildURL()}/${encodeURIComponent(backend)}/rotate-role/${encodeURIComponent(id)}`,
      'POST'
    );
  }
}
