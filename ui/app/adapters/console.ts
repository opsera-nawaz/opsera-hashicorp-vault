/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationAdapter from './application';

export default class ConsoleAdapter extends ApplicationAdapter {
  namespace = 'v1';
  pathForType(modelName: string): string {
    return modelName;
  }
}
