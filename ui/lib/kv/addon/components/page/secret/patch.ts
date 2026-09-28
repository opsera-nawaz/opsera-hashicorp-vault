/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { task } from 'ember-concurrency';
import { waitFor } from '@ember/test-waiters';

import type ApiService from 'vault/services/api';
import type ControlGroupService from 'vault/services/control-group';
import type FlashMessageService from 'vault/services/flash-messages';
import type RouterService from '@ember/routing/router-service';
import type { ApiParsedError } from 'vault/api';
import type { Breadcrumb } from 'vault/app-types';
import type { KvSecretMetadata, KvSubkeysMetadata } from 'kv/utils/kv-types';

interface Args {
  path: string;
  backend: string;
  metadata: KvSecretMetadata | null;
  subkeys: Record<string, unknown>;
  subkeysMeta?: KvSubkeysMetadata;
  breadcrumbs: Breadcrumb[];
}

interface ErrorLog {
  type: string;
  content: string;
}

/**
 * @module KvSecretPatch
 * @description
 * This page template provides two methods for submitting patch data to update a KV v2 secret.
 * Either using a key/value form KvPatch::Editor::Form or the json editor via KvPatch::JsonForm
 *
 * <Page::Secret::Patch
 *  @backend="my-kv-engine"
 *  @breadcrumbs={{this.breadcrumbs}
 *  @metadata={{this.model.metadata}}
 *  @path="my-secret"
 *  @subkeys={{this.subkeys}
 *  @subkeysMeta={{this.subkeysMeta}
 * />
 *
 * @param {model} path - Secret path
 * @param {string} backend - Mount backend path
 * @param {model} metadata - secret metadata
 * @param {object} subkeys - subkeys (leaf keys with null values) of kv v2 secret
 * @param {object} subkeysMeta - metadata object returned from the /subkeys endpoint, contains: version, created_time, custom_metadata, deletion status and time
 * @param {array} breadcrumbs - breadcrumb objects to render in page header
 */

export default class KvSecretPatch extends Component<Args> {
  @service declare readonly controlGroup: ControlGroupService;
  @service declare readonly flashMessages: FlashMessageService;
  @service('app-router') declare readonly router: RouterService;
  @service declare readonly api: ApiService;

  @tracked controlGroupError: ErrorLog | undefined;
  @tracked errorMessage: string | undefined;
  @tracked invalidFormAlert: string | undefined;
  @tracked patchMethod = 'UI';

  @action
  selectPatchMethod(event: Event): void {
    this.patchMethod = (event.target as HTMLInputElement).value;
  }

  @task
  @waitFor
  *save(data: Record<string, unknown>) {
    const isEmpty = this.isEmpty(data);
    if (isEmpty) {
      this.flashMessages.info(`No changes to submit. No updates made to "${this.args.path}".`);
      this.onCancel();
      return;
    }

    try {
      const { backend, path, metadata, subkeysMeta } = this.args;
      // if no metadata permission, use subkey metadata as backup
      const version = metadata?.current_version || subkeysMeta?.version;
      const payload = { options: { cas: version }, data };
      yield this.api.secrets.kvV2Patch(path, backend, payload);
      this.flashMessages.success(`Successfully patched new version of ${path}.`);
      this.router.transitionTo('vault.cluster.secrets.backend.kv.secret.index');
    } catch (error) {
      const { message, response } = (yield this.api.parseError(error)) as ApiParsedError;
      if (response?.isControlGroupError) {
        this.controlGroup.saveTokenFromError(response);
        this.controlGroupError = this.controlGroup.logFromError(response) as ErrorLog;
        return;
      }
      this.errorMessage = message;
      this.invalidFormAlert = 'There was an error submitting this form.';
    }
  }

  @action
  onCancel(): void {
    this.router.transitionTo('vault.cluster.secrets.backend.kv.secret.index');
  }

  isEmpty(object: Record<string, unknown>): boolean {
    const emptyKeys = Object.keys(object).every((k) => k === '');
    const emptyValues = Object.values(object).every((v) => v === '');
    return emptyKeys && emptyValues;
  }
}
