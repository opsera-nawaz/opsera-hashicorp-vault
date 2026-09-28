/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model, { attr } from '@ember-data/model';
import { computed } from '@ember/object';
import { alias } from '@ember/object/computed';
import KeyMixin from 'vault/mixins/key-mixin';
import lazyCapabilities, { apiPath } from 'vault/macros/lazy-capabilities';

// `vault/mixins/key-mixin` is still a classic `Mixin.create({...})` JS file (out of scope for
// this story), so its computed properties (isFolder, parentKey, keyWithoutParent, etc.) aren't
// resolvable to a precise native-class shape here. `.extend()` (rather than
// `class ... extends Model.extend(KeyMixin)`) is kept to avoid guessing at that shape; the
// object hash below still gets real, checked method signatures.
export default Model.extend(KeyMixin, {
  failedServerRead: attr('boolean'),
  auth: attr('string'),
  lease_duration: attr('number'),
  lease_id: attr('string'),
  renewable: attr('boolean'),

  secretData: attr('object'),
  secretKeyAndValue: computed('secretData', function () {
    const data: Record<string, unknown> = this.secretData;
    return Object.keys(data).map((key) => {
      return { key, value: data[key] };
    });
  }),

  isAdvancedFormat: computed('secretData', function () {
    const data: Record<string, unknown> = this.secretData;
    return data && Object.keys(data).some((key) => typeof data[key] !== 'string');
  }),

  helpText: attr('string'),
  // TODO this needs to be a relationship like `engine` on kv-v2
  backend: attr('string'),
  secretPath: lazyCapabilities(apiPath`${'backend'}/${'id'}`, 'backend', 'id'),
  canEdit: alias('secretPath.canUpdate'),
  canDelete: alias('secretPath.canDelete'),
  canRead: alias('secretPath.canRead'),
});
