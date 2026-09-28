/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

/* eslint-disable ember/no-observers */
import Helper from '@ember/component/helper';
import { service } from '@ember/service';
import { observer } from '@ember/object';

import type PermissionsService from 'vault/services/permissions';
import type NamespaceService from 'vault/services/namespace';

interface HasPermissionParams {
  routeParams?: string | string[];
  requireAll?: boolean;
}

export default class HasPermissionHelper extends Helper {
  @service declare readonly permissions: PermissionsService;
  @service declare readonly namespace: NamespaceService;

  // Recompute when either ACL OR namespace path changes
  onPermissionsChange = observer(
    'permissions.exactPaths',
    'permissions.globPaths',
    'permissions.canViewAll',
    'permissions.chrootNamespace',
    'namespace.path',
    function (this: HasPermissionHelper) {
      this.recompute();
    }
  );

  compute([route]: [string], params: HasPermissionParams): boolean {
    const { routeParams, requireAll } = params || {};
    return this.permissions.hasNavPermission(route, routeParams, requireAll);
  }
}
