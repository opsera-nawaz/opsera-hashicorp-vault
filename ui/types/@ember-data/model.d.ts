/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model, { attr } from 'ember-data/model';
import { DS } from 'ember-data';

export default Model;
export { attr };
export const belongsTo = DS.belongsTo;
export const hasMany = DS.hasMany;
