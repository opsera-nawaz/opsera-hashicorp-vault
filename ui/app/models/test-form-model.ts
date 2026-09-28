/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

// this model is just used for integration tests
//

import Model, { belongsTo, attr } from '@ember-data/model';

import type MountConfigModel from 'vault/models/mount-config';

export default class TestFormModel extends Model {
  @belongsTo('mount-config', { async: false, inverse: null }) declare config: MountConfigModel;
  @belongsTo('mount-config', { async: false, inverse: null }) declare otherConfig: MountConfigModel;

  @attr('string') declare path: string | undefined;
  @attr('string', { editType: 'textarea' }) declare description: string | undefined;
}
