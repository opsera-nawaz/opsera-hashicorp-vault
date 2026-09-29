/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationSerializer from '../application';

interface KeysPayload {
  data: { keys: string[]; [key: string]: unknown };
  backend?: string;
}

interface AlphabetItem {
  id: string;
  name: string;
  backend?: string;
}

export default class AlphabetSerializer extends ApplicationSerializer {
  primaryKey = 'name';

  extractLazyPaginatedData(payload: KeysPayload): AlphabetItem[] {
    return payload.data.keys.map((key) => {
      const model: AlphabetItem = {
        id: key,
        name: key,
      };
      if (payload.backend) {
        model.backend = payload.backend;
      }
      return model;
    });
  }
}
