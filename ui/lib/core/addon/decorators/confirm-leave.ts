/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { action } from '@ember/object';
import Route from '@ember/routing/route';
import Ember from 'ember';

import type Transition from '@ember/routing/transition';

// Loose EmberData-Model-like shape: `modelPath`/`silentCleanupPaths` are
// dynamic property paths, so the concrete model type can't be known statically.
interface DirtyTrackingModel {
  hasDirtyAttributes?: boolean;
  isSaving?: boolean;
  isNew?: boolean;
  unloadRecord(): void;
  rollbackAttributes(): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TS requires
// mixin-factory base constructors to accept `any[]`, see TS's own mixin pattern docs
type RouteConstructor = new (...args: any[]) => Route;

/**
 * Confirm that the user wants to discard unsaved changes before leaving the page. This decorator hooks into
 * the willTransition action. If you override setupController, be sure to set 'model' on the controller to
 * store data or this won't work.
 *
 * By default it will check if the route's model is dirty and prompt when leaving. Usage for this is simple:
 *
 * @withConfirmLeave()
 * export default class MyRoute extends Route {
 *   @service store;
 *   model() {
 *     return this.store.createRecord('some-model')
 *   }
 * }
 *
 * If the route has ember-data models at multiple paths, you can pass an array of secondary modelPaths which
 * will rollback on exit after the prompt for the first model is confirmed. In the example below, the window
 * will only prompt on leave if `model.main` is dirty. Either way, `model.secondary` and `model.optional`
 * will be cleaned up from the data store.
 *
 * @withConfirmLeave('model.main', ['model.secondary', 'model.optional'])
 * export default class MyRoute extends Route {
 *   @service store;
 *   model() {
 *     return {
 *       main: this.store.peekRecord('some-model', 'abc1')
 *       secondary: this.store.createRecord('some-other')
 *       optional: this.store.createRecord('optional')
 *     }
 *   }
 * }
 *
 */
export function withConfirmLeave(modelPath = 'model', silentCleanupPaths?: string[]) {
  return function decorator<T extends RouteConstructor>(SuperClass: T): T {
    if (!Object.prototype.isPrototypeOf.call(Route, SuperClass)) {
      // eslint-disable-next-line
      console.error(
        'withConfirmLeave decorator must be used on instance of ember Route class. Decorator not applied to returned class'
      );
      return SuperClass;
    }
    class ConfirmLeave extends SuperClass {
      _rollbackModel(modelPath: string): void {
        const model = this.controller.get(modelPath) as DirtyTrackingModel | undefined;
        // we only want to complete rollback if the model is dirty and not saving
        if (model && model.hasDirtyAttributes && !model.isSaving) {
          const method = model.isNew ? 'unloadRecord' : 'rollbackAttributes';
          model[method]();
        }
      }

      @action
      willTransition(transition: Transition): boolean {
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          (super.willTransition as (t: Transition) => void)?.(transition);
        } catch {
          // if the SuperClass doesn't have willTransition
          // defined calling it will throw an error.
        }
        const model = this.controller.get(modelPath) as DirtyTrackingModel | undefined;

        if (model && model.hasDirtyAttributes && !model.isSaving) {
          if (
            Ember.testing ||
            window.confirm(
              'You have unsaved changes. Navigating away will discard these changes. Are you sure you want to discard your changes?'
            )
          ) {
            this._rollbackModel(modelPath);
          } else {
            transition.abort();
            return false;
          }
        }
        silentCleanupPaths?.forEach((pathToModel) => {
          this._rollbackModel(pathToModel);
        });
        return true;
      }
    }
    return ConfirmLeave as unknown as T;
  };
}
