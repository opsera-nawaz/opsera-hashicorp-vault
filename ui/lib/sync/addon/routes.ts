/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import buildRoutes from 'ember-engines/routes';

import type { DSL } from '@ember/routing/lib/dsl';

export default buildRoutes(function (this: DSL): void {
  this.route('secrets', function () {
    this.route('overview');
    this.route('destinations', function () {
      this.route('create', function () {
        this.route('destination', { path: '/:type' });
      });
      this.route('destination', { path: '/:type/:name' }, function () {
        this.route('edit');
        this.route('details');
        this.route('secrets');
        this.route('sync');
      });
    });
  });
});
