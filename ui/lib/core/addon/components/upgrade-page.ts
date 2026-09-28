/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
/**
 * @module UpgradePage
 *
 * @example
 * <UpgradePage @title="Namespaces" @minimumEdition="Vault Enterprise Pro" />
 *
 */

interface UpgradePageArgs {
  title?: string;
  minimumEdition?: string;
}

export default class UpgradePage extends Component<UpgradePageArgs> {
  get minimumEdition(): string {
    return this.args.minimumEdition || 'Vault Enterprise';
  }
  get title(): string {
    return this.args.title || 'Vault Enterprise';
  }

  get featureName(): string {
    return this.title === 'Vault Enterprise' ? 'this feature' : this.title;
  }
}
