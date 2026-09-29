/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationAdapter from './application';

export default class PermissionsAdapter extends ApplicationAdapter {
  query() {
    const namespace = this.namespaceService.userRootNamespace ?? this.namespaceService.path;
    return this.ajax(this.urlForQuery(), 'GET', { namespace });
  }

  urlForQuery(): string {
    return this.buildURL() + '/internal/ui/resultant-acl';
  }
}
