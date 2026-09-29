/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import NamedPathAdapter from '../named-path';

export default class OidcKeyAdapter extends NamedPathAdapter {
  pathForType(): string {
    return 'identity/oidc/key';
  }
  rotate(name: string, verification_ttl?: string) {
    const data = verification_ttl ? { verification_ttl } : {};
    // `snapshot` is unused by this adapter's urlForUpdateRecord chain (identity adapters build purely
    // from id/modelName), so it's safe to omit despite the base RESTAdapter signature requiring it.
    const urlForUpdateRecord = this.urlForUpdateRecord as (id: string, modelName: string) => string;
    return this.ajax(`${urlForUpdateRecord(name, 'oidc/key')}/rotate`, 'POST', { data });
  }
}
