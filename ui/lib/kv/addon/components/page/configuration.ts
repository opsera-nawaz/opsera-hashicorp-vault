/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
import { toLabel } from 'core/helpers/to-label';
import { duration } from 'core/helpers/format-duration';

import type { Breadcrumb } from 'vault/app-types';
import type { KvV2ReadConfigurationResponse } from '@hashicorp/vault-client-typescript';

interface Args {
  config: Partial<KvV2ReadConfigurationResponse>;
  backend: string;
  breadcrumbs: Breadcrumb[];
}

const CUSTOM_LABELS: Record<string, string> = {
  cas_required: 'Require check and set',
  delete_version_after: 'Automate secret deletion',
  max_versions: 'Maximum number of versions',
  default_lease_ttl: 'Default Lease TTL',
  max_lease_ttl: 'Max Lease TTL',
};

/**
 * @module KvConfigPageComponent
 * KvConfigPageComponent is a component to show secrets mount and engine configuration data
 *
 * @param {object} config - config data for mount and engine
 * @param {string} backend - The name of the kv secret engine.
 * @param {array} breadcrumbs - Breadcrumbs as an array of objects that contain label, route, and modelId. They are updated via the util kv-breadcrumbs to handle dynamic *pathToSecret on the list-directory route.
 */

export default class KvConfigPageComponent extends Component<Args> {
  label = (key: string): string => {
    const label = toLabel([key]);
    // map specific fields to custom labels
    return CUSTOM_LABELS[key] || label;
  };

  value = (key: string, value: unknown): unknown => {
    if (key === 'delete_version_after') {
      return value === '0s' ? 'Never delete' : duration([value as string | number]);
    }
    return value;
  };
}
