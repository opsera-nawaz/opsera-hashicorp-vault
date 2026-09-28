/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
import { dateFormat } from 'core/helpers/date-format';
import currentSecret from 'kv/helpers/current-secret';
import isDeleted from 'kv/helpers/is-deleted';

import type { Breadcrumb } from 'vault/app-types';
import type { KvCapabilities, KvSecretMetadata, KvSubkeysResponse } from 'kv/utils/kv-types';

interface Args {
  backend: string;
  breadcrumbs: Breadcrumb[];
  capabilities: KvCapabilities;
  isPatchAllowed: boolean;
  metadata: KvSecretMetadata | null;
  path: string;
  subkeys: KvSubkeysResponse | null;
}

/**
 * @module KvSecretOverview
 * <Page::Secret::Overview
 *   @backend={{this.model.backend}}
 *   @breadcrumbs={{this.breadcrumbs}}
 *   @capabilities={{this.model.capabilities}}
 *   @isPatchAllowed={{true}}
 *   @metadata={{this.model.metadata}}
 *   @path={{this.model.path}}
 *   @subkeys={{this.model.subkeys}}
 * />
 *
 * @param {string} backend - kv secret mount to make network request
 * @param {array} breadcrumbs - Array to generate breadcrumbs, passed to the page header component
 * @param {object} capabilities - capabilities for data, metadata, subkeys, delete and undelete paths
 * @param {boolean} isPatchAllowed - passed to KvSubkeysCard for rendering patch action. True when: (1) the version is enterprise, (2) a user has "patch" secret + "read" subkeys capabilities, (3) latest secret version is not deleted or destroyed
 * @param {model} metadata - secret metadata
 * @param {string} path - path to request secret data for selected version
 * @param {object} subkeys - API response from subkeys endpoint, object with "subkeys" and "metadata" keys. This arg is null for community edition
 */

export default class KvSecretOverview extends Component<Args> {
  get currentSecret() {
    return currentSecret(this.args.metadata);
  }

  get secretState(): string {
    if (this.args.metadata) {
      return this.currentSecret ? this.currentSecret.state : '';
    }
    if (this.args.subkeys?.metadata) {
      const { metadata } = this.args.subkeys;
      const state = metadata.destroyed
        ? 'destroyed'
        : isDeleted(metadata.deletion_time)
        ? 'deleted'
        : 'created';
      return state;
    }
    return 'created';
  }

  get versionSubtext(): string {
    const state = this.secretState;
    if (state === 'destroyed') {
      return 'The current version of this secret has been permanently deleted and cannot be restored.';
    }
    if (state === 'deleted') {
      const time =
        (this.currentSecret && this.currentSecret.deletionTime) || this.args.subkeys?.metadata?.deletion_time;
      // dateFormat's default style already is 'MMM d yyyy, h:mm:ss aa'; the second positional argument
      // here would only apply if passed as part of the first array (dateFormat's actual signature),
      // so omitting it preserves the original's (coincidentally identical) rendered output.
      const date = dateFormat([time], {});
      return `The current version of this secret was deleted ${date}.`;
    }
    return 'The current version of this secret.';
  }
}
