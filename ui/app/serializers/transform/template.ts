/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ApplicationSerializer from '../application';

import type Store from '@ember-data/store';
import type { ModelSchema } from 'ember-data'; // eslint-disable-line ember/use-ember-data-rfc-395-imports
import type { AdapterSnapshot } from 'vault/adapters/-types';

interface TemplatePayload {
  data?: { alphabet?: unknown; pattern?: string; [key: string]: unknown };
  backend?: string;
  [key: string]: unknown;
}

interface TemplateItem {
  id: string;
  name: string;
  backend?: string;
}

interface CaptureGroupJson {
  pattern?: string;
  alphabet?: unknown;
  [key: string]: unknown;
}

export default class TransformTemplateSerializer extends ApplicationSerializer {
  primaryKey = 'name';

  normalizeResponse(
    store: Store,
    primaryModelClass: ModelSchema,
    payload: TemplatePayload,
    id: string | number,
    requestType: string
  ) {
    if (payload.data?.alphabet) {
      payload.data.alphabet = [payload.data.alphabet];
    }
    // strip out P character from any named capture groups
    if (payload.data?.pattern) {
      this._formatNamedCaptureGroups(payload.data, '?P', '?');
    }
    return super.normalizeResponse(store, primaryModelClass, payload, id, requestType);
  }

  // @ts-expect-error - concrete override of JSONSerializer's generic serialize<K>; the loose
  // AdapterSnapshot stand-in isn't assignable to Snapshot<K>.
  serialize(snapshot: AdapterSnapshot, options?: object) {
    const json = super.serialize(snapshot as never, options ?? {}) as CaptureGroupJson;
    if (json.alphabet && Array.isArray(json.alphabet)) {
      // Templates should only ever have one alphabet
      json.alphabet = json.alphabet[0];
    }
    // add P character to any named capture groups
    if (json.pattern) {
      this._formatNamedCaptureGroups(json, '?', '?P');
    }
    return json;
  }

  _formatNamedCaptureGroups(json: CaptureGroupJson, replace: string, replaceWith: string): void {
    // named capture groups are handled differently between Go and js
    // first look for named capture groups in pattern string
    const regex = new RegExp(/\?P?(<(.+?)>)/, 'g');
    const namedGroups = json.pattern?.match(regex);
    if (namedGroups) {
      namedGroups.forEach((group) => {
        // add or remove P depending on destination
        json.pattern = json.pattern!.replace(group, group.replace(replace, replaceWith));
      });
    }
  }

  extractLazyPaginatedData(payload: { data: { keys: string[] }; backend?: string }): TemplateItem[] {
    return payload.data.keys.map((key) => {
      const model: TemplateItem = {
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
