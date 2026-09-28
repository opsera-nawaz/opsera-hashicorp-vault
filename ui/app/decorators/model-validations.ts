/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { validate } from 'vault/utils/forms/validate';

import type EmberDataModel from '@ember-data/model';
import type { ModelValidations, Validations } from 'vault/app-types';

// see documentation at ui/docs/model-validations.md for detailed usage information
//
// The decorator's return type is deliberately widened to `T` (rather than left inferred): with
// `experimentalDecorators`, the static type of a decorated class is not updated to the decorator's
// return type anyway (see the redeclared members on classes that use this decorator, e.g.
// SecretEngineModel), and letting TS infer the richer type here trips TS4058 ("has or is using name
// ... but cannot be named") against `declaration: true` because the added members reference
// internal, unexported ember-data/ember-object types.
// `any[]` below (both the generic constraint and the constructor rest param) is TypeScript's own
// required shape for a mixin constructor per TS2545 ("A mixin class must have a constructor with a
// single rest parameter of type 'any[]'") — there is no narrower type that satisfies that rule.
export function withModelValidations<T extends new (...args: any[]) => EmberDataModel>(
  validations: Validations
): (SuperClass: T) => T {
  return function decorator(SuperClass: T) {
    class WithModelValidations extends SuperClass {
      static _validations: Validations = validations;
      _validations: Validations = validations;

      constructor(...args: any[]) {
        super(...args);
        if (!validations || typeof validations !== 'object') {
          throw new Error('Validations object must be provided to constructor for setup');
        }
      }

      validate(): ModelValidations {
        return validate(this, this._validations);
      }
    }
    return WithModelValidations;
  };
}
