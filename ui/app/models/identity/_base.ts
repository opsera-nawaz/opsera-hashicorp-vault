/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model from '@ember-data/model';
import { assert } from '@ember/debug';
import { expandAttributeMeta } from 'vault/utils/field-to-attrs';

import type { FormField } from 'vault/app-types';

export default class IdentityModel extends Model {
  // overridden by every subclass; the base implementation only exists so `fields` below has
  // something to call before a subclass has had a chance to override it.
  get formFields(): string[] {
    assert('formFields should be overridden', false);
    return [];
  }

  get fields(): FormField[] {
    return expandAttributeMeta(this, this.formFields);
  }

  get identityType(): string | undefined {
    return String((this.constructor as typeof IdentityModel).modelName).split('/')[1];
  }
}
