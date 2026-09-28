/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

/**
 * @module AutocompleteInput
 * AutocompleteInput components are used as standard string inputs or optionally select options to append to input value
 *
 * @example
 * <AutocompleteInput @label="Label here" @subText="subtext here" @value="foo" @onChange={{log "on change called"}} />
 *
 * @param {string} value - input value
 * @param {function} onChange - fires when input value changes to mutate value param by caller
 * @param {string} [optionsTrigger] - display options dropdown when trigger character is input
 * @param {array} [options] - array of `{ label, value }` objects where label is displayed in options dropdown and value is appended to input value
 * @param {string} [label] - label to display above input
 * @param {string} [subText] - text to display below label
 * @param {string} [placeholder] - input placeholder
 */

interface AutocompleteOption {
  label: string;
  value: string;
}

interface AutocompleteInputArgs {
  value: string;
  onChange: (value: string) => void;
  optionsTrigger?: string;
  options?: AutocompleteOption[];
  label?: string;
  subText?: string;
  placeholder?: string;
}

export default class AutocompleteInputComponent extends Component<AutocompleteInputArgs> {
  @tracked showOptions = false;
  rootElement?: HTMLElement;
  inputElement?: HTMLElement | null;

  @action
  setElement(element: HTMLElement): void {
    this.rootElement = element;
    this.inputElement = element.querySelector<HTMLElement>('.input');
  }

  @action
  onInput(event: InputEvent): void {
    const { options = [], optionsTrigger } = this.args;
    if (optionsTrigger && options.length) {
      this.showOptions = event.data === optionsTrigger;
    }
    this.args.onChange((event.target as HTMLInputElement).value);
  }

  @action
  onFocusOut(event: FocusEvent): void {
    // Enable close on outside click
    if (!this.rootElement?.contains(event.relatedTarget as Node | null)) {
      this.showOptions = false;
    }
  }

  @action
  selectOption(value: string): void {
    // if trigger character is at start of value it needs to be trimmed
    const appendValue = value.startsWith(this.args.optionsTrigger ?? '') ? value.slice(1) : value;
    const newValue = this.args.value + appendValue;
    this.args.onChange(newValue);
    this.showOptions = false;
    this.inputElement?.focus();
  }
}
