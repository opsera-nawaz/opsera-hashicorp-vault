/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Controller from '@ember/controller';
import { getOwner } from '@ember/owner';

import type { EngineOwner } from 'vault/app-types';

export default class PkiKeysIndexController extends Controller {
  queryParams = ['page'];

  get mountPoint() {
    return (getOwner(this) as EngineOwner).mountPoint;
  }
}
