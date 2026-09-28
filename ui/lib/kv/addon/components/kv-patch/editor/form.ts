/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { A } from '@ember/array';
import {
  hasWhitespace,
  isNonString,
  WHITESPACE_WARNING,
  NON_STRING_WARNING,
} from 'vault/utils/forms/validators';

type KvPatchKeyState = 'enabled' | 'disabled' | 'deleted';

interface Args {
  isSaving: boolean;
  onCancel: () => void;
  onSubmit: (data: Record<string, unknown>) => void;
  subkeys: Record<string, unknown>;
  submitError?: string;
}

/**
 * @module KvPatch::Editor::Form
 * @description
 * This component renders one of two ways to patch a KV v2 secret (the other is using the JSON editor).
 * Each top-level subkey returned by the API endpoint renders in a disabled column with an empty (also disabled) value input beside it.
 * Initially, an edit or delete button is left of the value input. Clicking "Delete" marks a key for deletion (it does not remove the row).
 * Clicking "Edit" enables the value input (the key input for retrieved subkeys is never editable). Users can then input a new value for that key.
 * If either button is clicked it is replaced by a "Cancel" button. Canceling empties the value input and returns it to a 'disabled' state
 *
 * Additionally, there is one empty row at the bottom for adding new key/value pairs.
 * Clicking "Add" adds the new key/value pair to the internally tracked state (an array) and creates a new empty row.
 * Newly added keys are editable and therefore never disabled.
 * A newly added pair can be undone by clicking "Remove" which deletes the row and removes it from the tracked array.
 *
 * Clicking the "Reveal subkeys in JSON" toggle displays the full, nested subkey structure returned by the API.
 *
 * @example
 * <KvPatch::Editor::Form @subkeys={{@subkeys}} @onSubmit={{perform this.save}} @onCancel={{this.onCancel}} @isSaving={{this.save.isRunning}} />
 *
 * @param {boolean} isSaving - if true, disables the save and cancel buttons. useful if the onSubmit callback is a concurrency task
 * @param {function} onCancel - called when form is canceled
 * @param {function} onSubmit - called when form is saved, called with with the key value object containing patch data
 * @param {object} subkeys - leaf keys of a kv v2 secret, all values (unless a nested object with more keys) return null. https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2#read-secret-subkeys
 * @param {string} submitError - error message string from parent if submit failed
 */

export class KeyValueState {
  @tracked key: string;
  @tracked value: unknown;
  @tracked state: KvPatchKeyState; // 'enabled', 'disabled' or 'deleted'
  @tracked keyError = '';

  constructor({
    key,
    value = undefined,
    state = 'disabled',
  }: {
    key: string;
    value?: unknown;
    state?: KvPatchKeyState;
  }) {
    this.key = key;
    this.value = value;
    this.state = state;
  }

  get keyWarning(): string {
    return hasWhitespace(this.key) ? WHITESPACE_WARNING('this key') : '';
  }

  get valueWarning(): string {
    if (this.value === null) return '';
    return isNonString(this.value) ? NON_STRING_WARNING : '';
  }

  reset(): void {
    this.value = undefined;
    this.state = 'disabled';
  }

  @action
  updateValue(event: Event): void {
    this.value = (event.target as HTMLInputElement).value;
  }

  @action
  updateState(state: KvPatchKeyState): void {
    this.state = state;
  }
}

export default class KvPatchEditorForm extends Component<Args> {
  // private: NativeArray isn't nameable from '@ember/array' for declaration emit purposes
  @tracked private patchData = A<KeyValueState>(); // key value pairs in form
  @tracked showSubkeys = false;
  @tracked validationError = '';

  // tracked variables for new (initially empty) row of inputs.
  // once a user clicks "Add" a KeyValueState class is instantiated for that row
  @tracked newKey: string | undefined;
  @tracked newValue: unknown;

  isOriginalSubkey = (key: string): boolean => Object.keys(this.args.subkeys).includes(key);

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    const kvData = Object.keys(this.args.subkeys).map((key) => this.generateData(key));
    this.patchData = A(kvData);
    this.resetNewRow();
  }

  get newKeyWarning(): string {
    return hasWhitespace(this.newKey) ? WHITESPACE_WARNING('this key') : '';
  }

  get newValueWarning(): string {
    if (this.newValue === null) return '';
    return isNonString(this.newValue) ? NON_STRING_WARNING : '';
  }

  get newKeyError(): string {
    return this.validateKey(this.newKey);
  }

  generateData(key: string, value?: unknown, state?: KvPatchKeyState): KeyValueState {
    return new KeyValueState({ key, value, state });
  }

  resetNewRow(): void {
    this.newKey = undefined;
    this.newValue = undefined;
  }

  validateKey(key: string | undefined): string {
    return this.patchData.any((KV) => KV.key === key)
      ? `"${key}" key already exists. Update the value of the existing key or rename this one.`
      : '';
  }

  @action
  updateKey(KV: KeyValueState, event: Event): void {
    // KV is KeyValueState class
    const key = (event.target as HTMLInputElement).value;
    // if a user refocuses an input that already has a key
    // validateKey miscalculates and thinks it's a duplicate
    if (KV.key === key) return; // so we return if values match
    const isInvalid = this.validateKey(key);
    KV.keyError = isInvalid;
    if (isInvalid) return;
    // only set if valid, otherwise key matches original
    // subkey and input state updates to readonly
    KV.key = key;
  }

  @action
  updateNewKey(event: Event): void {
    const key = (event.target as HTMLInputElement).value;
    this.newKey = key;
  }

  @action
  updateNewValue(event: Event): void {
    this.newValue = (event.target as HTMLInputElement).value;
  }

  @action
  addRow(): void {
    if (!this.newKey || this.newKeyError) return;
    const KV = this.generateData(this.newKey, this.newValue, 'enabled');
    this.patchData.pushObject(KV);
    // reset tracked values after adding them to patchData
    this.resetNewRow();
  }

  @action
  undoKey(KV: KeyValueState): void {
    if (this.isOriginalSubkey(KV.key)) {
      // reset state to 'disabled' and value to undefined
      KV.reset();
    } else {
      // remove row all together
      this.patchData.removeObject(KV);
    }
  }

  @action
  submit(event: Event): void {
    event.preventDefault();
    if (this.newKeyError || this.patchData.any((KV) => !!KV.keyError)) {
      this.validationError = 'This form contains validations errors, please resolve those before submitting.';
      return;
    }

    // patchData will not include the last row if a user has not clicked "Add"
    // manually check for data and add it to this.patchData
    if (this.newKey) {
      this.addRow();
    }

    const data = this.patchData.reduce((obj: Record<string, unknown>, KV) => {
      // only include edited inputs
      const { state } = KV;
      if (state === 'enabled' || state === 'deleted') {
        const value = state === 'deleted' ? null : KV.value;
        obj[KV.key] = value;
      }
      return obj;
    }, {});

    this.args.onSubmit(data);
  }
}
