/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { next } from '@ember/runloop';
import { service } from '@ember/service';
import { task } from 'ember-concurrency';
import { waitFor } from '@ember/test-waiters';
import sortedVersions from 'kv/helpers/sorted-versions';
import isDeleted from 'kv/helpers/is-deleted';
import { isAdvancedSecret } from 'core/utils/advanced-secret';
import { dump } from 'js-yaml';

import type ApiService from 'vault/services/api';
import type FlashMessageService from 'vault/services/flash-messages';
import type RouterService from '@ember/routing/router-service';
import type { Breadcrumb } from 'vault/app-types';
import type { WrapInfo } from 'vault/api';
import type { KvCapabilities, KvSecretDataModel, KvSecretMetadata } from 'kv/utils/kv-types';
import type { SortedVersion } from 'kv/helpers/sorted-versions';

type DeleteType = 'delete-version' | 'delete-latest-version' | 'destroy';

interface Args {
  backend: string;
  breadcrumbs: Breadcrumb[];
  capabilities: KvCapabilities;
  isPatchAllowed: boolean;
  metadata: KvSecretMetadata | null;
  path: string;
  secret: KvSecretDataModel;
}

/**
 * @module KvSecretDetails renders the key/value data of a KV secret.
 * It also renders a dropdown to display different versions of the secret.
 * <Page::Secret::Details
 *   @backend={{this.model.backend}}
 *   @breadcrumbs={{this.breadcrumbs}}
 *   @capabilities={{this.model.capabilities}}
 *   @isPatchAllowed={{this.model.isPatchAllowed}}
 *   @metadata={{this.model.metadata}}
 *   @path={{this.model.path}}
 *   @secret={{this.model.secret}}
 * />
 *
 * @param {string} backend - path where kv engine is mounted
 * @param {array} breadcrumbs - Array to generate breadcrumbs, passed to the page header component
 * @param {object} capabilities - capabilities for data, metadata, subkeys, delete and undelete paths
 * @param {boolean} isPatchAllowed - if true it renders "Patch latest version" toolbar action. True when: (1) the version is enterprise, (2) a user has "patch" secret + "read" subkeys capabilities, (3) latest secret version is not deleted or destroyed
 * @param {object} metadata - response object from /secret/metadata/path endpoint
 * @param {string} path - path of kv secret 'my/secret' used as the title for the KV page header
 * @param {object} secret - data and metadata objects from kvV2Read response - { secretData: data, ...metadata }
 */

export default class KvSecretDetails extends Component<Args> {
  @service declare readonly flashMessages: FlashMessageService;
  @service('app-router') declare readonly router: RouterService;
  @service declare readonly api: ApiService;

  @tracked format: 'ui' | 'json' | 'yaml' = 'ui';
  @tracked wrappedData: string | null = null;
  @tracked syncStatus: unknown[] | null = null; // array of association sync status info by destination

  declare originalSecret: string;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    this.fetchSyncStatus.perform();
    this.originalSecret = JSON.stringify(this.args.secret.secretData || {});
    if (isAdvancedSecret(this.originalSecret)) {
      // Default to JSON view if advanced
      this.format = 'json';
    }
  }

  // 'json' and 'yaml' both render the code block
  get showCodeView(): boolean {
    return this.format !== 'ui';
  }

  get secretDataAsYaml(): string {
    // fall back to an empty object so the view matches the JSON placeholder rather than rendering blank
    return dump(this.args.secret.secretData || {}, { noRefs: true });
  }

  @action
  setFormat(format: 'ui' | 'json' | 'yaml'): void {
    this.format = format;
  }

  @action
  closeVersionMenu(close: () => void): void {
    // strange issue where closing dropdown triggers full transition (which redirects to auth screen in production)
    // closing dropdown in next tick of run loop fixes it
    next(() => {
      close();
    });
  }

  @action
  clearWrappedData(): void {
    this.wrappedData = null;
  }

  @task
  @waitFor
  *wrapSecret() {
    try {
      const { secretData: data, ...metadata } = this.args.secret;
      const { wrap_info } = (yield this.api.sys.wrap(
        { data, metadata },
        this.api.buildHeaders({ wrap: '1800' })
      )) as { wrap_info: WrapInfo | null };
      if (!wrap_info?.token) throw new Error('No token');
      this.wrappedData = wrap_info.token;
      this.flashMessages.success('Secret successfully wrapped!');
    } catch {
      this.flashMessages.danger('Could not wrap secret.');
    }
  }

  // assigned as a field (rather than `@task` decorated) so its `.perform()` call in the
  // constructor above is properly typed as a Task instance.
  fetchSyncStatus = task(
    waitFor(async () => {
      try {
        const { backend: mount, path: secret_name } = this.args;
        const { associated_destinations } = await this.api.sys.systemReadSyncAssociationsDestinations(
          (context: Parameters<ApiService['addQueryParams']>[0]) =>
            this.api.addQueryParams(context, { mount, secret_name })
        );
        this.syncStatus = Object.values((associated_destinations as Record<string, unknown>) ?? {});
      } catch {
        // silently error
      }
    })
  );

  @action
  async undelete(): Promise<void> {
    const { backend, path } = this.args;
    try {
      await this.api.secrets.kvV2UndeleteVersions(path, backend, { versions: [Number(this.version)] });
      this.flashMessages.success(`Successfully undeleted ${path}.`);
      this.transition();
    } catch (err) {
      const { message } = await this.api.parseError(err);
      this.flashMessages.danger(`There was a problem undeleting ${path}. Error: ${message}.`);
    }
  }

  @action
  async handleDestruction(type: DeleteType): Promise<void> {
    const { backend, path } = this.args;
    try {
      if (type === 'destroy') {
        await this.api.secrets.kvV2DestroyVersions(path, backend, { versions: [Number(this.version)] });
      } else if (type === 'delete-latest-version') {
        await this.api.secrets.kvV2Delete(path, backend);
      } else if (type === 'delete-version') {
        await this.api.secrets.kvV2DeleteVersions(path, backend, { versions: [Number(this.version)] });
      } else {
        throw 'type must be one of delete-latest-version, delete-version, or destroy.';
      }
      const verb = type.includes('delete') ? 'deleted' : 'destroyed';
      this.flashMessages.success(`Successfully ${verb} Version ${this.version} of ${path}.`);
      this.transition();
    } catch (err) {
      const { message } = await this.api.parseError(err);
      const verb = type.includes('delete') ? 'deleting' : 'destroying';
      this.flashMessages.danger(
        `There was a problem ${verb} Version ${this.version} of ${path}. Error: ${message}.`
      );
    }
  }

  transition(): void {
    // transition to the overview to prevent automatically reading sensitive secret data
    this.router.transitionTo('vault.cluster.secrets.backend.kv.secret.index');
  }

  get sortedVersions(): SortedVersion[] {
    return sortedVersions(this.args.metadata?.versions);
  }

  get version(): number | string | undefined {
    return (
      this.args.secret?.version ||
      (this.router.currentRoute?.queryParams?.['version'] as string | undefined) ||
      this.sortedVersions[0]?.version
    );
  }

  get hideHeaders(): boolean {
    return this.showCodeView || !!this.emptyState;
  }

  get secretState(): 'destroyed' | 'deleted' | 'created' | '' {
    const { destroyed, created_time } = this.args.secret;
    if (destroyed) return 'destroyed';
    if (this.isSecretDeleted) return 'deleted';
    if (created_time) return 'created';
    return '';
  }

  get versionState(): 'destroyed' | 'deleted' | 'created' | '' {
    const { secret } = this.args;
    if (secret.failReadErrorCode !== 403) {
      return this.secretState;
    }
    // If the user can't read secret data, get the current version
    // state from metadata versions
    if (this.sortedVersions) {
      const version = this.version;
      const meta = version ? this.sortedVersions.find((v) => v.version == version) : this.sortedVersions[0];
      if (meta?.destroyed) {
        return 'destroyed';
      }
      if (isDeleted(meta?.deletion_time)) {
        return 'deleted';
      }
      if (meta?.created_time) {
        return 'created';
      }
    }
    return '';
  }

  get showUndelete(): boolean {
    const { canUndelete } = this.args.capabilities;
    if (canUndelete) {
      return this.versionState === 'deleted';
    }
    return false;
  }

  get showDelete(): boolean {
    const { canDeleteVersion, canDeleteLatestVersion } = this.args.capabilities;
    if (canDeleteVersion || canDeleteLatestVersion) {
      return this.versionState === 'created' || this.versionState === '';
    }
    return false;
  }

  get isSecretDeleted(): boolean {
    return isDeleted(this.args.secret.deletion_time);
  }

  get showDestroy(): boolean | number | string | undefined {
    const { canDestroyVersion } = this.args.capabilities;
    if (canDestroyVersion) {
      return this.versionState !== 'destroyed' && this.version;
    }
    return false;
  }

  get emptyState(): { title: string; message: string; link?: string } | false {
    const { canReadData, canReadMetadata } = this.args.capabilities;

    if (!canReadData) {
      return {
        title: 'You do not have permission to read this secret',
        message:
          'Your policies may permit you to write a new version of this secret, but do not allow you to read its current contents.',
      };
    }
    // only destructure if we can read secret data
    const { version, destroyed } = this.args.secret;
    if (destroyed) {
      return {
        title: `Version ${version} of this secret has been permanently destroyed`,
        message: `A version that has been permanently deleted cannot be restored. ${
          canReadMetadata
            ? ' You can view other versions of this secret in the Version History tab above.'
            : ''
        }`,
        link: '/vault/docs/secrets/kv/kv-v2',
      };
    }
    if (this.isSecretDeleted) {
      return {
        title: `Version ${version} of this secret has been deleted`,
        message: `This version has been deleted but can be undeleted. ${
          canReadMetadata
            ? 'View other versions of this secret by clicking the Version History tab above.'
            : ''
        }`,
        link: '/vault/docs/secrets/kv/kv-v2',
      };
    }
    return false;
  }
}
