/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationAdapter from './application';

export default class ControlGroupConfigAdapter extends ApplicationAdapter {
  pathForType(): string {
    return 'config/control-group';
  }

  urlForDeleteRecord(_id: string, modelName: string): string {
    return this.buildURL(modelName as never);
  }

  urlForFindRecord(_id: string, modelName: string): string {
    return this.buildURL(modelName as never);
  }

  urlForUpdateRecord(_id: string, modelName: string): string {
    return this.buildURL(modelName as never);
  }
}
