/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationAdapter from './application';

export default class MfaSetupAdapter extends ApplicationAdapter {
  currentTokenGenerate(data: Record<string, unknown>) {
    const url = `/v1/identity/mfa/method/totp/generate`;
    return this.ajax(url, 'POST', { data });
  }

  adminDestroy(data: Record<string, unknown>) {
    const url = `/v1/identity/mfa/method/totp/admin-destroy`;
    return this.ajax(url, 'POST', { data });
  }
}
