/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import fieldToAttrs, { expandAttributeMeta } from 'vault/utils/field-to-attrs';
import EmberDataModel from '@ember-data/model';

import type { FormField, FormFieldGroups, FormFieldGroupOptions } from 'vault/app-types';

type AttributeIterator = (callback: (name: string) => void) => void;

/**
 * sets formFields and/or formFieldGroups properties on model class based on attr options
 *
 * propertyNames must be an array of brace expansion supported strings that represent model attr names
 * groupPropertyNames must be an array of objects where the keys represent the group names and the values are propertyNames
 *
 * reference the field-to-attrs util for more information on expected format for fields and groups
 */

// `any[]` below (both the generic constraint and the constructor rest param) is TypeScript's own
// required shape for a mixin constructor per TS2545 ("A mixin class must have a constructor with a
// single rest parameter of type 'any[]'") — there is no narrower type that satisfies that rule.
export function withFormFields<T extends new (...args: any[]) => EmberDataModel>(
  propertyNames?: string[],
  groupPropertyNames?: Array<FormFieldGroupOptions>
) {
  return function decorator(SuperClass: T) {
    if (!Object.prototype.isPrototypeOf.call(EmberDataModel, SuperClass)) {
      // eslint-disable-next-line
      console.error(
        'withFormFields decorator must be used on instance of ember-data Model class. Decorator not applied to returned class'
      );
      return SuperClass;
    }
    class WithFormFields extends SuperClass {
      formFields: Array<FormField> = [];
      formFieldGroups: Array<FormFieldGroups> = [];
      allFields: Array<FormField> = [];

      constructor(...args: any[]) {
        super(...args);
        if (propertyNames) {
          this.formFields = expandAttributeMeta(this, propertyNames);
        }
        if (groupPropertyNames) {
          this.formFieldGroups = fieldToAttrs(this, groupPropertyNames);
        }
        const allFields: string[] = [];
        const eachAttribute = (this.constructor as unknown as { eachAttribute: AttributeIterator })
          .eachAttribute;
        eachAttribute((key: string) => {
          allFields.push(key);
        });
        this.allFields = expandAttributeMeta(this, allFields);
      }
    }
    return WithFormFields;
  };
}
