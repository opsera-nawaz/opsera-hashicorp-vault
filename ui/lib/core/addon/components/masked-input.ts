/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { debug } from '@ember/debug';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import autosize from 'autosize';

/**
 * @module MaskedInput
 * `MaskedInput` components are textarea inputs where the input is hidden. They are used to enter sensitive information like passwords.
 *
 * @example
 * <MaskedInput @value="my secret value" @allowCopy={{true}} @allowDownload={{true}} @onChange={{log "handle change"}} />
 *
 * @param {string} value - The value to display in the input.
 * @param {string} name - The key correlated to the value. Used for the download file name.
 * @param {function} [onChange=Callback] - Callback triggered on change, sends new value. Must set the value of @value
 * @param {function} [onKeyUp] - Callback triggered on keyup, sends the name and the current value.
 * @param {function} [onToggle] - Callback triggered when the mask is toggled, before the value is revealed or hidden. Useful for lazily fetching the value.
 * @param {boolean} [allowCopy=false]  - Whether or not the input should render with a copy button.
 * @param {boolean} [allowDownload=false]  - Renders a download button that prompts a confirmation modal to download the secret value
 * @param {boolean} [displayOnly=false]  - Whether or not to display the value as a display only `pre` element or as an input.
 *
 */
interface MaskedInputArgs {
  value?: unknown;
  name?: string;
  onChange?: (value: string) => void;
  onKeyUp?: (name: string | undefined, value: string) => void;
  onToggle?: () => void;
  allowCopy?: boolean;
  allowDownload?: boolean;
  displayOnly?: boolean;
}

export default class MaskedInputComponent extends Component<MaskedInputArgs> {
  @tracked showValue = false;
  @tracked modalOpen = false;
  @tracked stringifyDownload = false;

  constructor(owner: unknown, args: MaskedInputArgs) {
    super(owner, args);
    if (!this.args.onChange && !this.args.displayOnly) {
      debug('onChange is required for editable Masked Input!');
    }
  }

  updateSize(element: HTMLElement): void {
    autosize(element);
  }

  @action onChange(evt: Event): void {
    const value = (evt.target as HTMLTextAreaElement).value;
    if (this.args.onChange) {
      this.args.onChange(value);
    }
  }

  @action handleKeyUp(name: string | undefined, evt: Event): void {
    const { value } = evt.target as HTMLTextAreaElement;
    if (this.args.onKeyUp) {
      this.args.onKeyUp(name, value);
    }
  }

  @action toggleMask(): void {
    if (this.args.onToggle) {
      this.args.onToggle();
    }
    this.showValue = !this.showValue;
  }

  @action toggleStringifyDownload(event: Event): void {
    this.stringifyDownload = (event.target as HTMLInputElement).checked;
  }

  get copyValue(): string | unknown {
    // Value must be a string to be copied
    const { value } = this.args;
    if (!value || typeof value === 'string') return value;
    if (typeof value === 'object') return JSON.stringify(value);
    return (value as { toString(): string }).toString();
  }
}
