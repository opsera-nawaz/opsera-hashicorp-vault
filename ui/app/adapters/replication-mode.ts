/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationAdapter from './application';

export default class ReplicationModeAdapter extends ApplicationAdapter {
  getStatusUrl(mode: string): string {
    return this.buildURL() + `/replication/${mode}/status`;
  }

  fetchStatus(mode: string) {
    const url = this.getStatusUrl(mode);
    return this.ajax(url, 'GET', { unauthenticated: true }).then((resp: { data: unknown }) => {
      return resp.data;
    });
  }
}
