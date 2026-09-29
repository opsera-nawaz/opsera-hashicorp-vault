/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import BaseAdapter from './base';

export default class TransformTemplateAdapter extends BaseAdapter {
  pathForType(): string {
    return 'template';
  }
}
