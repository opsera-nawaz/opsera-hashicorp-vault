/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model, { attr, hasMany } from '@ember-data/model';
import ArrayProxy from '@ember/array/proxy';
import PromiseProxyMixin from '@ember/object/promise-proxy-mixin';
import { service } from '@ember/service';
import { isPresent } from '@ember/utils';
import { filterEnginesByMountCategory } from 'core/utils/all-engines-metadata';
import { withModelValidations } from 'vault/decorators/model-validations';
import { addManyToArray, addToArray } from 'vault/helpers/add-to-array';

import type ApiService from 'vault/services/api';
import type { Validations } from 'vault/app-types';
import type MfaMethodModel from 'vault/models/mfa-method';
import type EntityModel from 'vault/models/identity/entity';
import type GroupModel from 'vault/models/identity/group';

interface EnforcementTarget {
  key?: string;
  icon: string;
  link?: string;
  linkModels?: string[];
  title: string | undefined;
  subTitle: string | undefined;
}

interface AuthMethodSummary {
  accessor: string;
  path: string;
  type: string;
  [key: string]: unknown;
}

const validations: Validations = {
  name: [{ type: 'presence', message: 'Name is required' }],
  mfa_methods: [{ type: 'presence', message: 'At least one MFA method is required' }],
  targets: [
    {
      validator(model: MfaLoginEnforcementModel) {
        // avoid async fetch of records here and access relationship ids to check for presence
        const entityIds = model.hasMany('identity_entities').ids();
        const groupIds = model.hasMany('identity_groups').ids();
        return (
          isPresent(model.auth_method_accessors) ||
          isPresent(model.auth_method_types) ||
          isPresent(entityIds) ||
          isPresent(groupIds)
        );
      },
      message:
        "At least one target is required. If you've selected one, click 'Add' to make sure it's added to this enforcement.",
    },
  ],
};

interface TargetsPromiseProxy {
  create(init: { promise: Promise<EnforcementTarget[]> }): ArrayProxy<EnforcementTarget>;
}

@withModelValidations(validations)
export default class MfaLoginEnforcementModel extends Model {
  @service declare api: ApiService;

  @attr('string') declare name: string | undefined;
  @hasMany('mfa-method', { async: true, inverse: null }) declare mfa_methods: MfaMethodModel[];
  @attr('string') declare namespace_id: string | undefined;
  @attr('array', { defaultValue: () => [] }) declare auth_method_accessors: string[]; // ["auth_approle_17a552c6"]
  @attr('array', { defaultValue: () => [] }) declare auth_method_types: string[]; // ["userpass"]
  @hasMany('identity/entity', { async: true, inverse: null }) declare identity_entities: EntityModel[];
  @hasMany('identity/group', { async: true, inverse: null }) declare identity_groups: GroupModel[];

  get targets(): ArrayProxy<EnforcementTarget> {
    const TargetsProxy = ArrayProxy.extend(PromiseProxyMixin) as unknown as TargetsPromiseProxy;
    return TargetsProxy.create({
      promise: this.prepareTargets(),
    });
  }

  async prepareTargets(): Promise<EnforcementTarget[]> {
    let authMethods: AuthMethodSummary[] = [];
    let targets: EnforcementTarget[] = [];

    if (this.auth_method_accessors.length || this.auth_method_types.length) {
      // fetch all auth methods and lookup by accessor to get mount path and type
      try {
        const { data } = await this.api.sys.authListEnabledMethods();
        authMethods = this.api.responseObjectToArray(
          data as object | undefined,
          'path'
        ) as AuthMethodSummary[];
      } catch (error) {
        // swallow this error
      }
    }

    if (this.auth_method_accessors.length) {
      const selectedAuthMethods = authMethods.filter((method) => {
        return this.auth_method_accessors.includes(method.accessor);
      });
      targets = addManyToArray(
        targets,
        selectedAuthMethods.map((method) => ({
          icon: this.iconForMount(method.type),
          link: 'vault.cluster.access.method',
          linkModels: [method.path.slice(0, -1)],
          title: method.path,
          subTitle: method.accessor,
        }))
      );
    }

    this.auth_method_types.forEach((type) => {
      const icon = this.iconForMount(type);
      const mountCount = authMethods.filter((method) => method.type === type).length;
      targets = addToArray(targets, {
        key: 'auth_method_types',
        icon,
        title: type,
        subTitle: `All ${type} mounts (${mountCount})`,
      });
    });

    for (const key of ['identity_entities', 'identity_groups'] as const) {
      const relatedModels =
        key === 'identity_entities' ? await this.identity_entities : await this.identity_groups;
      relatedModels.forEach((model) => {
        targets = addToArray(targets, {
          key,
          icon: 'user',
          link: `vault.cluster.access.identity.${key.split('_')[1]}.show`,
          linkModels: [model.id, 'details'],
          title: model.name,
          subTitle: model.id,
        });
      });
    }

    return targets;
  }

  iconForMount(type: string): string {
    const mountableMethods = filterEnginesByMountCategory({ mountCategory: 'auth', isEnterprise: true });
    const mount = mountableMethods.find((method: { type: string }) => method.type === type);
    return mount ? mount.glyph || mount.type : 'token';
  }
}
