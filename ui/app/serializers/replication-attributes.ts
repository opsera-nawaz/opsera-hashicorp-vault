/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import RESTSerializer from '@ember-data/serializer/rest';
import { decamelize } from '@ember/string';

export default class ReplicationAttributesSerializer extends RESTSerializer {
  keyForAttribute(attr: string): string {
    return decamelize(attr);
  }
}
