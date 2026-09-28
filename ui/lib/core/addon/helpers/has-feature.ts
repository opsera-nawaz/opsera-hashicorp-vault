/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

/* eslint-disable ember/no-observers */
import { service } from '@ember/service';
import { assert } from '@ember/debug';
import Helper from '@ember/component/helper';
import { observer } from '@ember/object';

import type VersionService from 'vault/services/version';

const POSSIBLE_FEATURES = [
  'HSM',
  'Performance Replication',
  'DR Replication',
  'MFA',
  'Sentinel',
  'Seal Wrapping',
  'Control Groups',
  'Namespaces',
  'KMIP',
  'Transform Secrets Engine',
  'Key Management Secrets Engine',
];

export function hasFeature(featureName: string, features: string[] | null | undefined): boolean {
  if (!POSSIBLE_FEATURES.includes(featureName)) {
    assert(`${featureName} is not one of the available values for Vault Enterprise features.`, false);
    return false;
  }
  return features ? features.includes(featureName) : false;
}

export default class HasFeatureHelper extends Helper {
  @service declare readonly version: VersionService;

  onFeaturesChange = observer('version.features.[]', function (this: HasFeatureHelper) {
    this.recompute();
  });

  compute([featureName]: [string]): boolean {
    return hasFeature(featureName, this.version.features);
  }
}
