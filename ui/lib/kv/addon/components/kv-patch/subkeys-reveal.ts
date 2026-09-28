/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

interface Args {
  subkeys: Record<string, unknown>;
}

/**
 * @module SubkeysReveal
 *
 * @example
 * <SubkeysReveal @subkeys={{this.subkeys}} />
 *
 * @param {object} subkeys - leaf keys of a kv v2 secret, all values (unless a nested object with more keys) return null. https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2#read-secret-subkeys
 */

export default class SubkeysReveal extends Component<Args> {
  @tracked showSubkeys = false;
}
