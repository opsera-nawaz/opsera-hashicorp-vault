/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import BaseAdapter from './base';

export default class TransformRoleAdapter extends BaseAdapter {
  pathForType(): string {
    return 'role';
  }
}
