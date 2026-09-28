/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { attr } from '@ember-data/model';
import IdentityModel from './_base';

export default class EntityMergeModel extends IdentityModel {
  get formFields(): string[] {
    return ['toEntityId', 'fromEntityIds', 'force'];
  }

  @attr('string', {
    label: 'Entity ID to merge to',
  })
  declare toEntityId: string | undefined;

  @attr({
    label: 'Entity IDs to merge from',
    editType: 'stringArray',
  })
  declare fromEntityIds: string[] | undefined;

  @attr('boolean', {
    label: 'Keep MFA secrets from the "to" entity if there are merge conflicts',
    defaultValue: false,
  })
  declare force: boolean;
}
