/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
import engineDisplayData from 'vault/helpers/engines-display-data';
import {
  supportedSecretBackends,
  SupportedSecretBackendsEnum,
} from 'vault/helpers/supported-secret-backends';
import { getEffectiveEngineType } from 'vault/utils/external-plugin-helpers';

interface SecretEngineModel {
  id: string;
  engineType: string;
}

interface SecretListHeaderArgs {
  model: SecretEngineModel;
  isConfigure?: boolean;
}

interface Breadcrumb {
  label: string;
  route?: string;
  icon?: string;
  model?: string;
  current?: boolean;
}

/**
 * @module SecretListHeader
 * SecretListHeader component is breadcrumb, title with icon and menu with tabs component.
 *
 * Example is wrapped in back ticks because this component relies on routing and cannot render an isolated sample, so just rendering template sample
 * @example
 * ```
 * <SecretListHeader @model={{this.model}} />
 * ```
 *
 * @param {object} model - Model used to pull information about icon and title and backend type for navigation.
 * @param {boolean} [isConfigure=false] - Boolean to determine if the configure tab should be shown.
 */

export default class SecretListHeader extends Component<SecretListHeaderArgs> {
  get breadcrumbs(): Breadcrumb[] {
    const breadcrumbs: Breadcrumb[] = [
      { label: 'Vault', route: 'vault.cluster', icon: 'vault' },
      { label: 'Secrets engines', route: 'vault.cluster.secrets' },
      {
        label: this.args.model.id,
        route: 'vault.cluster.secrets.backend.list-root',
        model: this.args.model.id,
        current: !this.args.isConfigure,
      },
    ];

    if (this.args.isConfigure) {
      breadcrumbs.push({ label: 'Configure' });

      return breadcrumbs;
    }

    return breadcrumbs;
  }

  get effectiveEngineType(): string {
    return getEffectiveEngineType(this.args.model.engineType);
  }

  get isKV(): boolean {
    const effectiveType = getEffectiveEngineType(this.args.model.engineType);
    return ['kv', 'generic'].includes(effectiveType);
  }

  get showListTab(): boolean {
    // only show the list tab if the engine is not a configuration only engine and the UI supports it
    const effectiveType = getEffectiveEngineType(this.args.model.engineType);
    return (
      supportedSecretBackends().includes(effectiveType as SupportedSecretBackendsEnum) &&
      !engineDisplayData(effectiveType)?.isOnlyMountable
    );
  }
}
