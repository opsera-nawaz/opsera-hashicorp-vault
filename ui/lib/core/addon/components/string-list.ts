/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import ArrayProxy from '@ember/array/proxy';
import Component from '@glimmer/component';
import autosize from 'autosize';
import { action } from '@ember/object';
import { set } from '@ember/object';
import { next } from '@ember/runloop';
import { tracked } from '@glimmer/tracking';
import { addToArray } from 'vault/helpers/add-to-array';
import { removeFromArray } from 'vault/helpers/remove-from-array';

import type EmberArray from '@ember/array';

interface StringListItem {
  value: string;
}

// ArrayProxy.create({...})'s own typing doesn't propagate a usable `this`
// type into objectAtContent, nor infer a non-`never` element type from an
// empty `content: []` initializer (same root cause as kv-object-editor.ts's
// KvObjectInstance) — this component's actual usage is described directly.
interface StringListArrayProxy {
  length: number;
  filter(callback: (item: StringListItem) => boolean): StringListItem[];
  objectAt(idx: number): StringListItem | undefined;
  addObjects(items: StringListItem[]): void;
  pushObject(item: StringListItem): void;
  removeObject(item: StringListItem | undefined): void;
  slice(start: number): StringListItem[];
}

interface StringListArgs {
  label?: string;
  onChange: (value: string | string[]) => void;
  inputValue?: string | string[];
  helpText?: string;
  type?: string;
  attrName?: string;
  subText?: string;
}

/**
 * @module StringList
 *
 * @example
 * <StringList @label="My label" @inputValue={{array "one" "two"}} />
 *
 * @param {string} label - Text displayed in the header above all the inputs.
 * @param {function} onChange - Function called when any of the inputs change.
 * @param {string} inputValue - A string or an array of strings.
 * @param {string} helpText - Text displayed as a tooltip.
 * @param {string} type=array - Optional type for inputValue.
 * @param {string} attrName - We use this to check the type so we can modify the tooltip content.
 * @param {string} subText - Text below the label.
 */

export default class StringList extends Component<StringListArgs> {
  @tracked indicesWithComma: number[] = [];

  inputList!: StringListArrayProxy;
  type!: string;

  constructor(owner: unknown, args: StringListArgs) {
    super(owner, args);

    // inputList is type ArrayProxy, so addObject etc are fine here
    this.inputList = ArrayProxy.create({
      // trim the `value` when accessing objects
      content: [] as StringListItem[],
      objectAtContent: function (this: { content: EmberArray<StringListItem> }, idx: number) {
        const obj = this.content.objectAt(idx);
        if (obj && obj.value) {
          set(obj, 'value', obj.value.trim());
        }
        return obj;
      },
    }) as unknown as StringListArrayProxy;
    this.type = this.args.type || 'array';
    this.setType();
    next(() => {
      this.toList();
      this.addInput();
    });
  }

  setType(): void {
    const list = this.inputList;
    if (!list) {
      return;
    }
    this.type = typeof list;
  }

  toList(): void {
    let input = this.args.inputValue || [];
    const inputList = this.inputList;
    if (typeof input === 'string') {
      input = input.split(',');
    }
    inputList.addObjects(input.map((value) => ({ value })));
  }

  toVal(): string | string[] {
    const inputs = this.inputList
      .filter((x) => !!x.value)
      .map((x) => x.value)
      .filter((v): v is string => v !== undefined);
    if (this.args.type === 'string') {
      return inputs.join(',');
    }
    return inputs;
  }

  @action
  autoSize(element: HTMLElement): void {
    const textarea = element.querySelector<HTMLElement>('textarea');
    if (textarea) autosize(textarea);
  }

  @action
  autoSizeUpdate(element: HTMLElement): void {
    const textarea = element.querySelector<HTMLElement>('textarea');
    if (textarea) autosize.update(textarea);
  }

  @action
  inputChanged(idx: number, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value.includes(',') && !this.indicesWithComma.includes(idx)) {
      this.indicesWithComma = addToArray(this.indicesWithComma, idx);
    }
    if (!value.includes(',')) {
      this.indicesWithComma = removeFromArray(this.indicesWithComma, idx);
    }

    const inputObj = this.inputList.objectAt(idx);
    set(inputObj as object, 'value', value);
    this.args.onChange(this.toVal());
  }

  @action
  addInput(): void {
    const [lastItem] = this.inputList.slice(-1);
    if (lastItem?.value !== '') {
      this.inputList.pushObject({ value: '' });
    }
  }

  @action
  removeInput(idx: number): void {
    const itemToRemove = this.inputList.objectAt(idx);
    this.inputList.removeObject(itemToRemove);
    this.args.onChange(this.toVal());
  }
}
