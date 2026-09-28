/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
import { assert } from '@ember/debug';

/**
 * @module Icon
 * `Icon` components are used to display an icon.
 *
 * Flight icon documentation at https://helios.hashicorp.design/icons/usage-guidelines?tab=code#how-to-use-icons
 * Flight icon library at https://helios.hashicorp.design/icons/library
 *
 * @example
 * <Icon @name="heart" @size="24" />
 *
 * @param {string} name - The name of the SVG to render inline. Required.
 * @param {string} [size=16] - size for flight icon, can be 16 or 24
 *
 */

interface IconArgs {
  name: string;
  size?: string;
}

// TODO - deprecate and remove this after migrating all `<Icon />` instances to `<Hds::Icon />`
export default class IconComponent extends Component<IconArgs> {
  constructor(owner: unknown, args: IconArgs) {
    super(owner, args);

    const { name, size = '16' } = args;

    assert('Icon component size argument must be either "16" or "24"', ['16', '24'].includes(size));
    assert('Icon name argument must be provided', name);
  }
}
