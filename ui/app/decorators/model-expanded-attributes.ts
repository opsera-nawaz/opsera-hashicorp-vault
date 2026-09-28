/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { expandAttributeMeta } from 'vault/utils/field-to-attrs';
import EmberDataModel from '@ember-data/model';
import { debug } from '@ember/debug';

import type { FormField } from 'vault/app-types';

type FieldGroup = Record<string, string[]>;
type ExpandedFieldGroup = Record<string, FormField[]>;
type AttributeIterator = (callback: (name: string) => void) => void;
type RelationshipIterator = (
  callback: (name: string, details: { kind: string }) => void,
  binding?: unknown
) => void;

/**
 * sets allByKey properties on model class. These are all the attributes on the model
 * and any belongsTo models, expanded with attribute metadata. The value returned is an
 * object where the key is the attribute name, and the value is the expanded attribute
 * metadata.
 * This decorator also exposes a helper function `_expandGroups` which, when given groups
 * as expected in field-to-attrs util, will return a similar object with the expanded
 * attributes in place of the strings in the array.
 */

// `any[]` below (both the generic constraint and the constructor rest param) is TypeScript's own
// required shape for a mixin constructor per TS2545 ("A mixin class must have a constructor with a
// single rest parameter of type 'any[]'") — there is no narrower type that satisfies that rule.
export function withExpandedAttributes<T extends new (...args: any[]) => EmberDataModel>() {
  return function decorator(SuperClass: T) {
    if (!Object.prototype.isPrototypeOf.call(EmberDataModel, SuperClass)) {
      // eslint-disable-next-line
      console.error(
        'withExpandedAttributes decorator must be used on instance of ember-data Model class. Decorator not applied to returned class'
      );
      return SuperClass;
    }
    class WithExpandedAttributes extends SuperClass {
      constructor(...args: any[]) {
        super(...args);
      }

      // Helper method for expanding dynamic groups on model
      _expandGroups(groups: FieldGroup[]): ExpandedFieldGroup[] {
        if (!Array.isArray(groups)) {
          throw new Error('_expandGroups expects an array of objects');
        }
        /* Expects group shape to be something like:
        [
          { default: ['ttl', 'maxTtl'] },
          { "Method Options": ['other', 'fieldNames'] },
        ]*/
        return groups.map((obj) => {
          const entry = Object.entries(obj)[0] as [string, string[]];
          const [key, stringArray] = entry;
          const expanded = stringArray
            .map((fieldName) => this.allByKey[fieldName])
            .filter((f): f is FormField => !!f);
          // if this fails, it might mean there are missing fields in the model or the model must be hydrated via OpenAPI
          if (expanded.length !== stringArray.length) {
            debug(`not all model fields found in allByKey for group "${key}"`);
          }
          return { [key]: expanded };
        });
      }

      _allByKey: Record<string, FormField> | null = null;
      get allByKey(): Record<string, FormField> {
        // Caching like this ensures allByKey only gets calculated once
        if (!this._allByKey) {
          const byKey: Record<string, FormField> = {};
          const self = this as unknown as EmberDataModel;
          const selfCtor = this.constructor as unknown as {
            eachAttribute: AttributeIterator;
            eachRelationship: RelationshipIterator;
          };
          // First, get attr names which are on the model directly
          // By this time, OpenAPI should have populated non-explicit attrs
          const mainFields: string[] = [];
          selfCtor.eachAttribute(function (key: string) {
            mainFields.push(key);
          });
          const expanded = expandAttributeMeta(self, mainFields);
          expanded.forEach((attr) => {
            // Add expanded attributes from the model
            byKey[attr.name] = attr;
          });

          // Next, fetch and expand attrs for related models
          selfCtor.eachRelationship(function (name: string, descriptor: { kind: string }) {
            // We don't worry about getting hasMany relationships
            if (descriptor.kind !== 'belongsTo') return;
            const rModel = (self as unknown as Record<string, EmberDataModel | undefined>)[name];
            if (!rModel) return;
            const rModelCtor = rModel.constructor as unknown as { eachAttribute: AttributeIterator };
            const rAttrNames: string[] = [];
            rModelCtor.eachAttribute(function (key: string) {
              rAttrNames.push(key);
            });
            const expanded = expandAttributeMeta(rModel, rAttrNames);
            expanded.forEach((attr) => {
              byKey[`${name}.${attr.name}`] = {
                ...attr,
                options: {
                  ...attr.options,
                  // This ensures the correct path is updated in FormField
                  fieldValue: `${name}.${(attr.options as { fieldValue?: string })?.fieldValue || attr.name}`,
                },
              } as FormField;
            });
          }, self);
          this._allByKey = byKey;
        }
        return this._allByKey;
      }
    }
    return WithExpandedAttributes;
  };
}
