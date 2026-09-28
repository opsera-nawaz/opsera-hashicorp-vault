/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { action } from '@ember/object';
import isDeleted from 'kv/helpers/is-deleted';
import { kvErrorHandler } from 'kv/utils/kv-error-handler';

import type ApiService from 'vault/services/api';
import type CapabilitiesService from 'vault/services/capabilities';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type VersionService from 'vault/services/version';
import type Transition from '@ember/routing/transition';
import type { ModelFrom } from 'vault/route';
import type {
  KvCapabilities,
  KvSecretMetadata,
  KvSubkeysMetadata,
  KvSubkeysResponse,
} from 'kv/utils/kv-types';

export type SecretRouteModel = ModelFrom<KvSecretRoute>;

export default class KvSecretRoute extends Route {
  @service declare readonly api: ApiService;
  @service declare readonly secretMountPath: SecretMountPath;
  @service declare readonly capabilities: CapabilitiesService;
  @service declare readonly version: VersionService;

  async fetchSecretMetadata(backend: string, path: string): Promise<KvSecretMetadata | null> {
    // catch error and only return 404 which indicates the secret truly does not exist.
    // control group error is handled by the metadata route
    try {
      // KvV2ReadMetadataResponse types versions/custom_metadata as plain `object` since the OpenAPI
      // spec doesn't model them; KvSecretMetadata describes the actual shape the KV UI relies on.
      return (await this.api.secrets.kvV2ReadMetadata(path, backend)) as unknown as KvSecretMetadata;
    } catch (error) {
      const { status } = await this.api.parseError(error);
      if (status === 404) {
        throw error;
      }
      return null;
    }
  }

  // this request always returns subkeys for the latest version
  async fetchSubkeys(backend: string, path: string): Promise<KvSubkeysResponse | null> {
    if (this.version.isEnterprise) {
      try {
        // KvV2ReadSubkeysResponse types subkeys/metadata as plain `object`; KvSubkeysResponse
        // describes the actual shape the KV UI relies on (see kv-types.ts).
        return (await this.api.secrets.kvV2ReadSubkeys(path, backend)) as unknown as KvSubkeysResponse;
      } catch (error) {
        // metadata will throw if the secret does not exist
        // kvErrorHandler will extract deletion state and relevant metadata from error
        const { status, response } = await this.api.parseError(error);
        return kvErrorHandler(status, response);
      }
    }
    return null;
  }

  isPatchAllowed({
    capabilities,
    subkeysMeta = {},
  }: {
    capabilities: KvCapabilities;
    subkeysMeta?: Partial<KvSubkeysMetadata>;
  }): boolean {
    if (this.version.isEnterprise) {
      const { canReadSubkeys, canPatchData } = capabilities;
      if (canReadSubkeys && canPatchData && subkeysMeta) {
        const { deletion_time, destroyed } = subkeysMeta;
        const isLatestActive = isDeleted(deletion_time) || destroyed ? false : true;
        // only the latest secret version can be patched and it must not be deleted or destroyed
        return isLatestActive;
      }
    }
    return false;
  }

  async fetchCapabilities(backend: string, path: string): Promise<KvCapabilities> {
    const metadataPath = `${backend}/metadata/${path}`;
    const dataPath = `${backend}/data/${path}`;
    const subkeysPath = `${backend}/subkeys/${path}`;
    const deletePath = `${backend}/delete/${path}`;
    const undeletePath = `${backend}/undelete/${path}`;
    const destroyPath = `${backend}/destroy/${path}`;

    const apiPaths = [metadataPath, dataPath, subkeysPath, deletePath, undeletePath, destroyPath];
    const perms = await this.capabilities.fetch(apiPaths, {
      routeForCache: 'vault.cluster.secrets.backend.kv.secret',
    });

    // non-null: every path in apiPaths above is guaranteed an entry by capabilities.fetch's mapCapabilities
    const dataCaps = perms[dataPath]!;
    const metadataCaps = perms[metadataPath]!;
    const subkeysCaps = perms[subkeysPath]!;
    const deleteCaps = perms[deletePath]!;
    const undeleteCaps = perms[undeletePath]!;
    const destroyCaps = perms[destroyPath]!;

    return {
      canReadData: dataCaps.canRead,
      canUpdateData: dataCaps.canUpdate,
      canPatchData: dataCaps.canPatch,
      canCreateVersionData: dataCaps.canUpdate,
      canDeleteVersion: deleteCaps.canUpdate,
      canDeleteLatestVersion: dataCaps.canDelete,
      canDestroyVersion: destroyCaps.canUpdate,
      canReadMetadata: metadataCaps.canRead,
      canDeleteMetadata: metadataCaps.canDelete,
      canUpdateMetadata: metadataCaps.canUpdate,
      canUndelete: undeleteCaps.canUpdate,
      canReadSubkeys: subkeysCaps.canRead,
    };
  }

  async model(): Promise<{
    path: string;
    backend: string;
    subkeys: KvSubkeysResponse | null;
    metadata: KvSecretMetadata | null;
    isPatchAllowed: boolean;
    capabilities: KvCapabilities;
  }> {
    const backend = this.secretMountPath.currentPath;
    const { name: path } = this.paramsFor('secret') as { name: string };
    const capabilities = await this.fetchCapabilities(backend, path);
    const subkeys = await this.fetchSubkeys(backend, path);
    const metadata = await this.fetchSecretMetadata(backend, path);

    return {
      path,
      backend,
      subkeys,
      metadata,
      isPatchAllowed: this.isPatchAllowed({ capabilities, subkeysMeta: subkeys?.metadata }),
      capabilities,
    };
  }

  @action
  willTransition(transition: Transition): void {
    // refresh the route if transitioning to secret.index (which happens after delete, undelete or destroy)
    // or transitioning from editing either metadata or secret data (creating a new version)
    const isToIndex = transition.to?.name === 'vault.cluster.secrets.backend.kv.secret.index';
    const isFromEdit = transition.from?.localName === 'edit';
    if (isToIndex || isFromEdit) {
      this.refresh();
    }
  }
}
