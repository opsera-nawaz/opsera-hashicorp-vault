/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import sortedVersions from 'kv/helpers/sorted-versions';
import getCurrentSecret from 'kv/helpers/current-secret';
import isDeleted from 'kv/helpers/is-deleted';

import type ApiService from 'vault/services/api';
import type { Breadcrumb } from 'vault/app-types';
import type { KvSecretMetadata } from 'kv/utils/kv-types';
import type { SortedVersion } from 'kv/helpers/sorted-versions';

interface Args {
  metadata: KvSecretMetadata;
  path: string;
  backend: string;
  breadcrumbs: Breadcrumb[];
}

/**
 * @module KvSecretMetadataVersionDiff renders the version diff comparison
 * <Page::Secret::Metadata::VersionDiff
 *  @metadata={{this.model.metadata}}
 *  @path={{this.model.path}}
 *  @backend={{this.model.backend}}
 *  @breadcrumbs={{this.breadcrumbs}}
 * />
 *
 * @param {object} metadata - secret metadata
 * @param {string} path - path to request secret data for selected version
 * @param {string} backend - kv secret mount to make network request
 * @param {array} breadcrumbs - Array to generate breadcrumbs, passed to the page header component
 */

export default class KvSecretMetadataVersionDiff extends Component<Args> {
  @service declare readonly api: ApiService;

  @tracked leftVersion: number | undefined;
  @tracked rightVersion: number | undefined;
  @tracked visualDiff: string | null = null;
  @tracked statesMatch = false;

  constructor(owner: unknown, args: Args) {
    super(owner, args);

    // initialize with most recently (before current), active version on left
    const olderVersions = this.sortedVersions.slice(1);
    const recentlyActive = olderVersions.find((v) => !v.destroyed && !isDeleted(v.deletion_time));
    this.leftVersion = Number(recentlyActive?.version);
    this.rightVersion = this.args.metadata.current_version;

    // this diff is from older to newer (current) secret data
    this.createVisualDiff();
  }

  get sortedVersions(): SortedVersion[] {
    return sortedVersions(this.args.metadata.versions);
  }

  // this can only be true on initialization if the current version is inactive
  // selecting a deleted/destroyed version is otherwise disabled
  get deactivatedState(): string {
    const { current_version } = this.args.metadata;
    const currentSecret = getCurrentSecret(this.args.metadata);
    return this.rightVersion === current_version && currentSecret && currentSecret.isDeactivated
      ? currentSecret.state
      : '';
  }

  @action
  handleSelect(side: 'leftVersion' | 'rightVersion', version: string, close: () => void): void {
    this[side] = Number(version);
    close();
    this.createVisualDiff();
  }

  async createVisualDiff(): Promise<void> {
    const leftSecretData = await this.fetchSecretData(this.leftVersion);
    const rightSecretData = await this.fetchSecretData(this.rightVersion);
    const diffpatcher = jsondiffpatch.create({});
    const delta = diffpatcher.diff(leftSecretData, rightSecretData);

    this.statesMatch = !delta;
    this.visualDiff = delta
      ? htmlformatter.format(delta, leftSecretData) ?? ''
      : JSON.stringify(rightSecretData, undefined, 2);
  }

  async fetchSecretData(version: number | undefined): Promise<Record<string, unknown> | undefined> {
    const { backend, path } = this.args;
    const initOverride = version
      ? (context: Parameters<ApiService['addQueryParams']>[0]) =>
          this.api.addQueryParams(context, { version })
      : undefined;
    try {
      const { data } = await this.api.secrets.kvV2Read(path, backend, undefined, initOverride);
      return data as Record<string, unknown> | undefined;
    } catch {
      // capabilities checks are higher up the tree so this request should not fail
      return undefined;
    }
  }
}
