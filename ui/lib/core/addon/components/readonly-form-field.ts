/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

/**
 * @module ReadonlyFormField
 * ReadonlyFormField components are used to render an attribute that is read only
 *
 * @example
 * <ReadonlyFormField @attr={{hash name="toDo" options=(hash label="To do task" helpText="helpful text")}} @value="Complete!"/>
 *
 * @param {object} attr - Should be an attribute from a model exported with expandAttributeMeta
 * @param {any} value - The value that should be displayed on the input
 */

import Component from '@glimmer/component';
import { capitalize, dasherize } from '@ember/string';
import { humanize } from 'vault/helpers/humanize';

interface AttrMeta {
  name?: string;
  options?: { label?: string };
}

interface ReadonlyFormFieldArgs {
  attr?: AttrMeta;
  value?: unknown;
}

export default class ReadonlyFormField extends Component<ReadonlyFormFieldArgs> {
  get labelString(): string {
    if (!this.args.attr) {
      return '';
    }
    const label = this.args.attr.options ? this.args.attr.options.label : '';
    const name = this.args.attr.name;
    if (label) {
      return label;
    }
    if (name) {
      return capitalize(humanize([dasherize(name)]));
    }
    return '';
  }
}
