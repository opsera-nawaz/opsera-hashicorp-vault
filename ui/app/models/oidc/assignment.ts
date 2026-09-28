/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model, { attr } from '@ember-data/model';
import lazyCapabilities, { apiPath, type CapabilitiesPathProxy } from 'vault/macros/lazy-capabilities';
import { withModelValidations } from 'vault/decorators/model-validations';
import { isPresent } from '@ember/utils';

import type { Validations } from 'vault/app-types';

const validations: Validations = {
  name: [
    { type: 'presence', message: 'Name is required.' },
    {
      type: 'containsWhiteSpace',
      message: 'Name cannot contain whitespace.',
    },
  ],
  targets: [
    {
      validator(model: OidcAssignmentModel) {
        return isPresent(model.entityIds) || isPresent(model.groupIds);
      },
      message: 'At least one entity or group is required.',
    },
  ],
};

@withModelValidations(validations)
export default class OidcAssignmentModel extends Model {
  @attr('string') declare name: string | undefined;
  @attr('array') declare entityIds: string[] | undefined;
  @attr('array') declare groupIds: string[] | undefined;

  // CAPABILITIES
  @lazyCapabilities(apiPath`identity/oidc/assignment/${'name'}`, 'name')
  declare assignmentPath: CapabilitiesPathProxy;
  get canRead(): boolean {
    return this.assignmentPath.get('canRead') ?? false;
  }
  get canEdit(): boolean {
    return this.assignmentPath.get('canUpdate') ?? false;
  }
  get canDelete(): boolean {
    return this.assignmentPath.get('canDelete') ?? false;
  }
}
