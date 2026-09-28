/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import buildRoutes from 'ember-engines/routes';

import type { DSL } from '@ember/routing/lib/dsl';

function ldapRouteMap(this: DSL): void {
  this.route('overview');
  this.route('roles', function (this: DSL) {
    this.route('create');
    // wildcard route so we can traverse hierarchical roles i.e. prod/admin/my-role
    this.route('subdirectory', { path: '/:type/subdirectory/*path_to_role' });
    this.route('role', { path: '/:type/:name' }, function (this: DSL) {
      this.route('details');
      this.route('edit');
      this.route('credentials');
    });
  });
  this.route('libraries', function (this: DSL) {
    this.route('create');
    // wildcard route so we can traverse hierarchical libraries i.e. prod/admin/my-library
    this.route('subdirectory', { path: '/subdirectory/*path_to_library' });
    this.route('library', { path: '/:name' }, function (this: DSL) {
      this.route('details', function (this: DSL) {
        this.route('accounts');
        this.route('configuration');
      });
      this.route('edit');
      this.route('check-out');
    });
  });
  this.route('configure');
  this.route('configuration');
}

export default buildRoutes(ldapRouteMap);
