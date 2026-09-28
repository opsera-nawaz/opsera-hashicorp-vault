/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import AdapterError from '@ember-data/adapter/error';
import { service } from '@ember/service';
import Component from '@ember/component';
import { task } from 'ember-concurrency';
import { next } from '@ember/runloop';
import { waitFor } from '@ember/test-waiters';
import { tracked } from '@glimmer/tracking';

import type FlashMessageService from 'vault/services/flash-messages';

interface EditFormModel {
  validate?: () => { isValid: boolean; state: unknown; invalidFormMessage: string };
  isDirty?: boolean;
  isDestroyed?: boolean;
  isDestroying?: boolean;
  rollbackAttributes(): void;
  save(): Promise<unknown>;
  destroyRecord(): Promise<unknown>;
  [key: string]: unknown;
}

interface SaveOptions {
  method?: 'save' | 'destroyRecord';
}

export default class EditForm extends Component {
  @service declare readonly flashMessages: FlashMessageService;

  // internal validations
  @tracked invalidFormAlert = '';

  @tracked modelValidations: unknown = null;

  // public API
  model: EditFormModel | null = null;

  successMessage = 'Saved!';
  deleteSuccessMessage = 'Deleted!';
  deleteButtonText = 'Delete';
  saveButtonText = 'Save';
  cancelButtonText = 'Cancel';
  cancelLink = null;
  flashEnabled = true;
  includeBox = true;

  /*
   * @param Function
   * @public
   *
   * Optional param to call a function upon successfully saving a model
   */
  onSave: (data: { saveType: string; model: EditFormModel }) => void = () => {};

  // onSave may need values updated in render in a helper - if this
  // is the case, set this value to true
  callOnSaveAfterRender = false;

  checkModelValidity(model: EditFormModel): boolean {
    if (model.validate) {
      const { isValid, state, invalidFormMessage } = model.validate();
      this.modelValidations = state;
      this.invalidFormAlert = invalidFormMessage;
      return isValid;
    }
    // no validations on model; return true
    return true;
  }

  save = task(
    waitFor(function* (this: EditForm, model: EditFormModel, options: SaveOptions = { method: 'save' }) {
      const { method = 'save' } = options;
      const messageKey = method === 'save' ? 'successMessage' : 'deleteSuccessMessage';
      if (method === 'save' && !this.checkModelValidity(model)) {
        // if saving and model invalid, don't continue
        return;
      }
      try {
        yield model[method]();
      } catch (err) {
        // err will display via model state
        // AdapterErrors are handled by the error-message component
        if (!(err instanceof AdapterError)) {
          throw err;
        }
        return;
      }
      if (this.flashEnabled) {
        this.flashMessages.success(this[messageKey]);
      }
      if (this.callOnSaveAfterRender) {
        next(() => {
          this.onSave({ saveType: method, model });
        });
        return;
      }
      this.onSave({ saveType: method, model });
    })
  ).drop();

  willDestroy(): void {
    try {
      const { model } = this;
      if (model && model.isDirty && !model.isDestroyed && !model.isDestroying) {
        model.rollbackAttributes();
      }
    } catch {
      // silent catch if component is torn down after store is unloaded
    }
    super.willDestroy();
  }
}
