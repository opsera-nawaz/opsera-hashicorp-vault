/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import JSONSerializer from 'ember-data/serializers/json';
import type DS from 'ember-data';
import type { ModelSchema as ModelSchemaType } from 'ember-data';

export default JSONSerializer;
export type Snapshot = DS.Snapshot;
export type ModelSchema = ModelSchemaType;
