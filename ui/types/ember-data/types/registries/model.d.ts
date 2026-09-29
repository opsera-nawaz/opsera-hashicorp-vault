/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import type AwsCredentialModel from 'vault/models/aws-credential';
import type CapabilitiesModel from 'vault/models/capabilities';
import type ClusterModel from 'vault/models/cluster';
import type ControlGroupModel from 'vault/models/control-group';
import type ControlGroupConfigModel from 'vault/models/control-group-config';
import type DatabaseConnectionModel from 'vault/models/database/connection';
import type DatabaseCredentialModel from 'vault/models/database/credential';
import type DatabaseRoleModel from 'vault/models/database/role';
import type GeneratedItemModel from 'vault/models/generated-item';
import type EntityAliasModel from 'vault/models/identity/entity-alias';
import type EntityMergeModel from 'vault/models/identity/entity-merge';
import type EntityModel from 'vault/models/identity/entity';
import type GroupAliasModel from 'vault/models/identity/group-alias';
import type GroupModel from 'vault/models/identity/group';
import type MfaLoginEnforcementModel from 'vault/models/mfa-login-enforcement';
import type MfaMethod from 'vault/models/mfa-method';
import type MountConfigModel from 'vault/models/mount-config';
import type NodeModel from 'vault/models/node';
import type OidcAssignmentModel from 'vault/models/oidc/assignment';
import type OidcKeyModel from 'vault/models/oidc/key';
import type PathFilterConfigModel from 'vault/models/path-filter-config';
import type PolicyModel from 'vault/models/policy';
import type AclModel from 'vault/models/policy/acl';
import type EgpModel from 'vault/models/policy/egp';
import type RgpModel from 'vault/models/policy/rgp';
import type ReplicationAttributesModel from 'vault/models/replication-attributes';
import type ReplicationModeModel from 'vault/models/replication-mode';
import type RoleAwsModel from 'vault/models/role-aws';
import type RoleJwtModel from 'vault/models/role-jwt';
import type SecretEngineModel from 'vault/models/secret-engine';
import type SecretModel from 'vault/models/secret';
import type TestFormModel from 'vault/models/test-form-model';
import type TransformAlphabetModel from 'vault/models/transform/alphabet';
import type TransformRoleModel from 'vault/models/transform/role';
import type TransformTemplateModel from 'vault/models/transform/template';
import type TransitKeyModel from 'vault/models/transit-key';

declare module 'ember-data/types/registries/model' {
  export default interface ModelRegistry {
    'aws-credential': AwsCredentialModel;
    capabilities: CapabilitiesModel;
    cluster: ClusterModel;
    'control-group': ControlGroupModel;
    'control-group-config': ControlGroupConfigModel;
    'database/connection': DatabaseConnectionModel;
    'database/credential': DatabaseCredentialModel;
    'database/role': DatabaseRoleModel;
    'generated-item': GeneratedItemModel;
    'identity/entity-alias': EntityAliasModel;
    'identity/entity-merge': EntityMergeModel;
    'identity/entity': EntityModel;
    'identity/group-alias': GroupAliasModel;
    'identity/group': GroupModel;
    'mfa-login-enforcement': MfaLoginEnforcementModel;
    'mfa-method': MfaMethod;
    'mount-config': MountConfigModel;
    node: NodeModel;
    'oidc/assignment': OidcAssignmentModel;
    'oidc/key': OidcKeyModel;
    'path-filter-config': PathFilterConfigModel;
    policy: PolicyModel;
    'policy/acl': AclModel;
    'policy/egp': EgpModel;
    'policy/rgp': RgpModel;
    'replication-attributes': ReplicationAttributesModel;
    'replication-mode': ReplicationModeModel;
    'role-aws': RoleAwsModel;
    'role-jwt': RoleJwtModel;
    'secret-engine': SecretEngineModel;
    secret: SecretModel;
    'test-form-model': TestFormModel;
    'transform/alphabet': TransformAlphabetModel;
    'transform/role': TransformRoleModel;
    'transform/template': TransformTemplateModel;
    'transit-key': TransitKeyModel;
  }
}
