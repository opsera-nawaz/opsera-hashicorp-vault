/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import KvForm from 'vault/forms/secrets/kv';

import type ApiService from 'vault/services/api';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type { KvSecretMetadata } from 'kv/utils/kv-types';
import type { SecretRouteModel } from '../secret';

export interface MetadataRouteModel extends SecretRouteModel {
  form: KvForm;
}

export default class KvSecretMetadataRoute extends Route {
  @service declare readonly secretMountPath: SecretMountPath;
  @service declare readonly api: ApiService;

  async fetchMetadata(backend: string, path: string): Promise<KvSecretMetadata | null> {
    try {
      // KvV2ReadMetadataResponse types versions/custom_metadata as plain `object`; KvSecretMetadata
      // describes the actual shape the KV UI relies on (see kv-types.ts).
      return (await this.api.secrets.kvV2ReadMetadata(path, backend)) as unknown as KvSecretMetadata;
    } catch (error) {
      const { response } = await this.api.parseError(error);
      if (response?.isControlGroupError) {
        throw response;
      }
      // if users can read secret data they can make an explicit request to retrieve secret data in the component
      return null;
    }
  }

  async model(): Promise<MetadataRouteModel> {
    const parentModel = this.modelFor('secret') as SecretRouteModel;
    const { backend, path } = parentModel;
    if (!parentModel.metadata) {
      // metadata read on the secret root fails silently
      // if there's no metadata, try again in case it's a control group
      parentModel.metadata = await this.fetchMetadata(backend, path);
    }

    const { custom_metadata, max_versions, cas_required, delete_version_after } = parentModel.metadata || {};
    return {
      ...parentModel,
      form: new KvForm({
        path,
        custom_metadata: custom_metadata ?? undefined,
        max_versions,
        cas_required,
        delete_version_after,
      }),
    };
  }
}
