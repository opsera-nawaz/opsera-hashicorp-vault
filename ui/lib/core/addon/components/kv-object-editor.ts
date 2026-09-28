/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { isNone } from '@ember/utils';
import { assert } from '@ember/debug';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import KVObject from 'vault/lib/kv-object';
import {
  hasWhitespace,
  isNonString,
  NON_STRING_WARNING,
  WHITESPACE_WARNING,
} from 'vault/utils/forms/validators';

interface KvDatum {
  name: string;
  value: unknown;
}

// KVObject is an ArrayProxy.extend({...}) (app/lib/kv-object.js, out of this
// story's scope); `.extend()`'s own type doesn't propagate its custom
// methods (fromJSON/toJSON/etc.) onto `.create()`'s result, so this
// component's actual usage is described directly instead.
interface KvObjectInstance {
  length: number;
  fromJSON(json: Record<string, unknown> | null | undefined): KvObjectInstance;
  toJSON(): Record<string, unknown>;
  find(callback: (datum: KvDatum) => boolean): KvDatum | undefined;
  addObject(obj: KvDatum): void;
  objectAt(index: number): KvDatum | undefined;
  removeAt(index: number): void;
  uniqBy(key: string): { length: number };
}

interface KvObjectEditorArgs {
  value?: Record<string, unknown> | null;
  onChange: (value: Record<string, unknown>) => void;
  isMasked?: boolean;
  isSingleRow?: boolean;
  onKeyUp?: (value: string) => void;
  label?: string;
  labelClass?: string;
  warning?: string;
  helpText?: string;
  subText?: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  allowWhiteSpace?: boolean;
  warnNonStringValues?: boolean;
}

/**
 * @module KvObjectEditor
 * KvObjectEditor components are called in FormFields when the editType on the model is kv.  They are used to show a key-value input field.
 *
 * @example
 * <KvObjectEditor @value={{hash foo="bar"}} @onChange={{log "on change called"}} @label="Label here" />
 *
 * @param {string} value - the value is captured from the model.
 * @param {function} onChange - function that captures the value on change
 * @param {boolean} [isMasked = false] - when true the `MaskedInput` renders instead of the default `textarea` to input the value portion of the key/value object
 * @param {boolean} [isSingleRow = false] - when true the kv object editor will only show one row and hide the Add button
 * @param {function} [onKeyUp] - function passed in that handles the dom keyup event. Used for validation on the kv custom metadata.
 * @param {string} [label] - label displayed over key value inputs
 * @param {string} [labelClass] - override default label class in FormFieldLabel component
 * @param {string} [warning] - warning that is displayed
 * @param {string} [helpText] - helper text. In tooltip.
 * @param {string} [subText] - placed under label.
 * @param {string} [keyPlaceholder] - placeholder for key input
 * @param {string} [valuePlaceholder] - placeholder for value input
 * @param {boolean} [allowWhiteSpace = false] - when true, allows whitespace in the key input
 * @param {boolean} [warnNonStringValues = false] - when true, shows a warning if the value is a non-string
 */

export default class KvObjectEditor extends Component<KvObjectEditorArgs> {
  // kvData is type ArrayProxy, so addObject etc are fine here
  @tracked kvData!: KvObjectInstance;
  whitespaceWarning = WHITESPACE_WARNING('key');
  nonStringWarning = NON_STRING_WARNING;

  get placeholders() {
    return {
      key: this.args.keyPlaceholder || 'key',
      value: this.args.valuePlaceholder || 'value',
    };
  }
  get hasDuplicateKeys(): boolean {
    return this.kvData.uniqBy('name').length !== this.kvData.length;
  }

  // fired on did-insert from render modifier
  @action
  createKvData(_elem: HTMLElement, [value]: [Record<string, unknown> | null | undefined]): void {
    this.kvData = (KVObject.create({ content: [] }) as unknown as KvObjectInstance).fromJSON(value);

    if (!this.args.isSingleRow || !value || Object.keys(value).length < 1) {
      this.addRow();
    }
  }
  @action
  addRow(): void {
    if (!isNone(this.kvData.find((datum) => datum.name === ''))) {
      return;
    }
    const newObj = { name: '', value: '' };
    guidFor(newObj);
    this.kvData.addObject(newObj);
  }
  @action
  updateRow(): void {
    this.args.onChange(this.kvData.toJSON());
  }
  @action
  deleteRow(object: KvDatum, index: number): void {
    const oldObj = this.kvData.objectAt(index);
    assert('object guids match', guidFor(oldObj) === guidFor(object));
    this.kvData.removeAt(index);
    this.args.onChange(this.kvData.toJSON());
  }
  @action
  handleKeyUp(event: Event): void {
    if (this.args.onKeyUp) {
      this.args.onKeyUp((event.target as HTMLInputElement).value);
    }
  }
  showWhitespaceWarning = (name: string): boolean => {
    if (this.args.allowWhiteSpace) return false;
    return hasWhitespace(name);
  };

  showNonStringWarning = (value: unknown): boolean => {
    if (!this.args.warnNonStringValues) return false;
    return isNonString(value);
  };
}
