/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import errorMessage from 'vault/utils/error-message';
import { waitFor } from '@ember/test-waiters';

import type ApiService from 'vault/services/api';
import type ControlGroupService from 'vault/services/control-group';
import type FlashMessageService from 'vault/services/flash-messages';
import type RouterService from '@ember/routing/router-service';
import type { Breadcrumb } from 'vault/app-types';
import type { KvCapabilities, KvSecretMetadata } from 'kv/utils/kv-types';

interface Args {
  backend: string;
  breadcrumbs: Breadcrumb[];
  capabilities: KvCapabilities;
  metadata: KvSecretMetadata | null;
  path: string;
}

interface ErrorLog {
  type: string;
  content: string;
  isControlGroup?: boolean;
}

/**
 * @module KvSecretMetadataDetails renders the details view for kv metadata and button to delete (which deletes the whole secret) or edit metadata.
 * <Page::Secret::Metadata::Details
 *   @backend={{this.model.backend}}
 *   @breadcrumbs={{this.breadcrumbs}}
 *   @capabilities={{this.model.capabilities}}
 *   @metadata={{this.model.metadata}}
 *   @path={{this.model.path}}
 * />
 *
 * @param {string} backend - The name of the kv secret engine.
 * @param {array} breadcrumbs - Array to generate breadcrumbs, passed to the page header component
 * @param {object} capabilities - capabilities for data, metadata, subkeys, delete and undelete paths
 * @param {object} metadata - kv metadata
 * @param {string} path - path of kv secret 'my/secret' used as the title for the KV page header
 *
 *
 */

export default class KvSecretMetadataDetails extends Component<Args> {
  @service declare readonly controlGroup: ControlGroupService;
  @service declare readonly flashMessages: FlashMessageService;
  @service('app-router') declare readonly router: RouterService;
  @service declare readonly api: ApiService;

  @tracked error: ErrorLog | string | null = null;
  @tracked customMetadataFromData: Record<string, string> | null = null;
  @tracked didRequestData = false;

  get customMetadata(): Record<string, string> | null {
    return this.args.metadata?.custom_metadata || this.customMetadataFromData;
  }

  get canRequestData(): boolean {
    const { canReadMetadata, canReadData } = this.args.capabilities;
    return !canReadMetadata && canReadData && !this.didRequestData;
  }

  @action
  async onDelete(): Promise<void> {
    // The only delete option from this view is delete metadata and all versions
    const { backend, path } = this.args;
    try {
      await this.api.secrets.kvV2DeleteMetadataAndAllVersions(path, backend);
      this.flashMessages.success(
        `Successfully deleted the metadata and all version data for the secret ${path}.`
      );
      this.router.transitionTo('vault.cluster.secrets.backend.kv.list');
    } catch (err) {
      this.flashMessages.danger(`There was an issue deleting ${path} metadata. \n ${errorMessage(err)}`);
    }
  }

  @action
  @waitFor
  async requestData(): Promise<void> {
    const { backend, path } = this.args;
    try {
      const { metadata } = await this.api.secrets.kvV2Read(path, backend);
      this.customMetadataFromData = (metadata as KvSecretMetadata | undefined)?.custom_metadata ?? null;
      this.didRequestData = true;
    } catch (err) {
      const { message, response } = await this.api.parseError(err);
      if (response?.isControlGroupError) {
        this.controlGroup.saveTokenFromError(response);
        const errorLog = this.controlGroup.logFromError(response) as ErrorLog;
        errorLog.isControlGroup = true;
        this.error = errorLog;
      } else {
        // this.error's previous value (often still `null` at this point) has no bearing on the new
        // string message below, so there's nothing to mark isControlGroup false on.
        this.error = message;
      }
    }
  }
}
