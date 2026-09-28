/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { assert } from '@ember/debug';
import currentSecret from 'kv/helpers/current-secret';

import type { KvCapabilities, KvSecretDataModel, KvSecretMetadata } from 'kv/utils/kv-types';

type DeleteMode = 'delete' | 'delete-metadata' | 'destroy';
type DeleteType = 'delete-version' | 'delete-latest-version' | 'destroy';

interface Args {
  mode: DeleteMode;
  // callers pass the route model's narrower `secret` sub-object, which doesn't carry backend/path
  // itself — those are only present when the caller happens to be modeling the full secret route.
  secret: KvSecretDataModel & { backend?: string; path?: string };
  metadata?: KvSecretMetadata;
  text?: string;
  capabilities: KvCapabilities;
  version?: number | string;
  onDelete: (type: DeleteType) => void;
}

/**
 * @module KvDeleteModal displays a button for a delete type and launches a modal. Undelete is the only mode that does not launch the modal and is not handled in this component.
 *
 * <KvDeleteModal
 *  @mode="destroy"
 *  @secret={{this.model.secret}}
 *  @metadata={{this.model.metadata}}
 *  @capabilities={{this.model.capabilities}}
 *  @onDelete={{this.handleDestruction}}
 * />
 *
 * @param {string} mode - delete, delete-metadata, or destroy.
 * @param {object} secret - secret data.
 * @param {object} [metadata] - secret metadata. It is only required when mode is "delete".
 * @param {string} [text] - Button text that renders in KV v2 toolbar, defaults to capitalize @mode
 * @param {object} capabilities - capabilities for data, metadata, subkeys, delete and undelete paths
 * @param {callback} onDelete - callback function fired to handle delete event.
 */

export default class KvDeleteModal extends Component<Args> {
  @tracked deleteType: DeleteType | null = null; // Either delete-version or delete-current-version.
  @tracked modalOpen = false;

  get modalDisplay(): { title: string; color: string; intro: string } {
    switch (this.args.mode) {
      // Does not match adapter key directly because a delete type must be selected.
      case 'delete':
        return {
          title: 'Delete version?',
          color: 'warning',
          intro:
            'There are two ways to delete a version of a secret. Both delete actions can be undeleted later. How would you like to proceed?',
        };
      case 'destroy':
        return {
          title: 'Destroy version?',
          color: 'critical',
          intro: `This action will permanently destroy Version ${this.args.version} of the secret, and the secret data cannot be read or recovered later.`,
        };
      case 'delete-metadata':
        return {
          title: 'Delete metadata and secret data?',
          color: 'critical',
          intro:
            'This will permanently delete the metadata and versions of the secret. All version history will be removed. This cannot be undone.',
        };
      default:
        assert('mode must be one of delete, destroy, or delete-metadata.', false);
    }
  }

  get currentSecret() {
    return currentSecret(this.args.metadata);
  }

  get deleteOptions(): Array<{
    key: DeleteType;
    label: string;
    description: string;
    disabled: boolean;
    tooltipMessage: string;
  }> {
    const { capabilities, secret, version } = this.args;
    const { canDeleteVersion, canDeleteLatestVersion } = capabilities;
    const isDeactivated = (this.currentSecret && this.currentSecret.isDeactivated) || false;
    return [
      {
        key: 'delete-version',
        label: 'Delete this version',
        description: `This deletes ${version ? `Version ${version}` : `a specific version`} of the secret.`,
        disabled: !canDeleteVersion,
        tooltipMessage: `Deleting a specific version requires "update" capabilities to ${secret.backend}/delete/${secret.path}.`,
      },
      {
        key: 'delete-latest-version',
        label: 'Delete latest version',
        description: 'This deletes the most recent version of the secret.',
        disabled: !canDeleteLatestVersion || isDeactivated,
        tooltipMessage: isDeactivated
          ? `The latest version of the secret is already ${
              this.currentSecret ? this.currentSecret.state : ''
            }.`
          : `Deleting the latest version of this secret requires "delete" capabilities to ${secret.backend}/data/${secret.path}.`,
      },
    ];
  }

  @action
  onDelete(): void {
    const type = (this.args.mode === 'delete' ? this.deleteType : this.args.mode) as DeleteType;
    this.args.onDelete(type);
    this.modalOpen = false;
  }
}
