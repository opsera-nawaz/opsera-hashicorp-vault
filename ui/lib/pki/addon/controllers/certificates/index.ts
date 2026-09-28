/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Controller from '@ember/controller';
import { getOwner } from '@ember/owner';
import { action } from '@ember/object';

import type { EngineOwner } from 'vault/app-types';

export default class PkiCertificatesIndexController extends Controller {
  queryParams = ['page'];
  declare filter: string;
  declare filterFocused: boolean;

  get mountPoint() {
    return (getOwner(this) as EngineOwner).mountPoint;
  }

  @action setFilter(val: string) {
    this.filter = val;
  }
  @action setFilterFocus(bool: boolean) {
    this.filterFocused = bool;
  }
}
