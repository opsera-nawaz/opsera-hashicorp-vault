/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationAdapter from './application';

import type Store from '@ember-data/store';
import type { AdapterModelSchema, AdapterSnapshot } from './-types';

export default class AwsCredentialAdapter extends ApplicationAdapter {
  // @ts-expect-error - concrete override of RESTAdapter's generic createRecord<K>; this codebase's
  // adapters consistently override with concrete (non-generic) params, see app/adapters/-types.ts.
  createRecord(store: Store, type: AdapterModelSchema, snapshot: AdapterSnapshot) {
    const ttl = snapshot.attr('ttl') as string | undefined;
    const roleArn = snapshot.attr('roleArn') as string | undefined;
    const roleType = snapshot.attr('credentialType') as string | undefined;
    let method = 'POST';
    let options: Record<string, unknown> | undefined;
    const data: Record<string, unknown> = {};
    if (roleType === 'iam_user') {
      method = 'GET';
    } else {
      if (ttl) {
        data['ttl'] = ttl;
      }
      if (roleType === 'assumed_role' && roleArn) {
        data['role_arn'] = roleArn;
      }
      options = data['ttl'] || data['role_arn'] ? { data } : {};
    }
    const role = snapshot.attr('role') as { backend: string; name: string };
    const url = `/v1/${role.backend}/creds/${role.name}`;

    return this.ajax(url, method, options).then((response: Record<string, unknown>) => {
      response['id'] = snapshot.id;
      response['modelName'] = type.modelName;
      store.pushPayload(type.modelName as never, response);
    });
  }
}
