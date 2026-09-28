/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model from '@ember-data/model';
import { tracked } from '@glimmer/tracking';

import type { FormField } from 'vault/app-types';

type AttributeIterator = (
  callback: (name: string, meta: { options?: Record<string, unknown> }) => void
) => void;

// This model is used for OpenApi-generated models in path-help service's getNewModel method
export default class GeneratedItemModel extends Model {
  allFields: FormField[] = [];

  @tracked declare _id: string | undefined;
  get mutableId(): string | undefined {
    return this._id || this.id;
  }
  set mutableId(value: string | undefined) {
    this._id = value;
  }

  get fieldGroups(): Array<Record<string, FormField[]>> {
    const groups: Record<string, FormField[]> = {
      default: [],
    };
    const fieldGroups: Array<Record<string, FormField[]>> = [];
    const eachAttribute = (this.constructor as unknown as { eachAttribute: AttributeIterator }).eachAttribute;
    eachAttribute((_name, attr) => {
      // if the attr comes in with a fieldGroup from OpenAPI,
      const fieldGroup = (attr.options as { fieldGroup?: string } | undefined)?.fieldGroup;
      const formField = attr as unknown as FormField;
      if (fieldGroup) {
        if (groups[fieldGroup]) {
          groups[fieldGroup].push(formField);
        } else {
          groups[fieldGroup] = [formField];
        }
      } else {
        // otherwise just add that attr to the default group
        groups['default']!.push(formField);
      }
    });
    for (const group in groups) {
      fieldGroups.push({ [group]: groups[group]! });
    }
    return fieldGroups;
  }
}
