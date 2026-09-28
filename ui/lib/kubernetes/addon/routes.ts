/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import buildRoutes from 'ember-engines/routes';

import type { DSL } from '@ember/routing/lib/dsl';

function kubernetesRouteMap(this: DSL): void {
  this.route('overview');
  this.route('roles', function (this: DSL) {
    this.route('create');
    this.route('role', { path: '/:name' }, function (this: DSL) {
      this.route('details');
      this.route('edit');
      this.route('credentials');
    });
  });
  this.route('configure');
  this.route('configuration');
}

export default buildRoutes(kubernetesRouteMap);
