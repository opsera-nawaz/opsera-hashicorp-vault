/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Controller from '@ember/controller';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

import type { Breadcrumb } from 'vault/app-types';

export default class PkiRolesSignController extends Controller {
  declare breadcrumbs: Breadcrumb[];
  @tracked hasSubmitted = false;

  @action
  toggleTitle() {
    this.hasSubmitted = !this.hasSubmitted;
  }
}
