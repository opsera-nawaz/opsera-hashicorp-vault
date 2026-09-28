/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { paginate } from 'core/utils/paginate-list';
import { SecretsApiPkiListIssuersListEnum } from '@hashicorp/vault-client-typescript';
import { verifyCertificates, parseCertificate } from 'vault/utils/parse-pki-cert';

import type Controller from '@ember/controller';
import type ApiService from 'vault/services/api';
import type SecretMountPath from 'vault/services/secret-mount-path';
import type { PaginatedMetadata } from 'core/utils/paginate-list';
import type { PkiReadIssuerResponse } from '@hashicorp/vault-client-typescript';
import type { ParsedCertificateData } from 'vault/utils/parse-pki-cert';
import type { Breadcrumb } from 'vault/app-types';

type KeyInfoEntry = Record<string, unknown>;
export type IssuerListItem = KeyInfoEntry &
  Partial<PkiReadIssuerResponse> & {
    isRoot?: boolean;
    parsedCertificate?: ParsedCertificateData;
  };

export interface IssuersIndexRouteModel {
  issuers?: IssuerListItem[] & PaginatedMetadata;
  parentModel: unknown;
}

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
  page?: string;
}

export default class PkiIssuersListRoute extends Route {
  @service declare readonly secretMountPath: SecretMountPath;
  @service declare readonly api: ApiService;

  // Returns a new enriched copy of the key_info entry for the given issuer_id.
  // Falls back to the bare list-stub on error so a single failing read doesn't break the page.
  async getIssuerMetadata(issuer_id: string, keyInfoEntry: KeyInfoEntry): Promise<IssuerListItem> {
    try {
      const issuer = await this.api.secrets.pkiReadIssuer(issuer_id, this.secretMountPath.currentPath);
      const isRoot = await verifyCertificates(issuer.certificate as string, issuer.certificate as string);
      const parsedCertificate = parseCertificate(issuer.certificate as string);
      return { ...keyInfoEntry, ...issuer, isRoot, parsedCertificate };
    } catch {
      return { ...keyInfoEntry };
    }
  }

  async model(params: { page?: string }): Promise<IssuersIndexRouteModel> {
    const page = Number(params.page) || 1;
    const parentModel = this.modelFor('issuers');

    try {
      const listResponse = await this.api.secrets.pkiListIssuers(
        this.secretMountPath.currentPath,
        SecretsApiPkiListIssuersListEnum.TRUE
      );
      const keys = listResponse.keys ?? [];
      const keyInfo = (listResponse.key_info ?? {}) as Record<string, KeyInfoEntry>;

      // fetch full issuer data only if there are 10 or fewer issuers to avoid making too many requests
      let enrichedKeyInfo: Record<string, KeyInfoEntry> = keyInfo;
      if (keys.length <= 10) {
        const enrichedEntries = await Promise.all(
          keys.map((issuer_id) => this.getIssuerMetadata(issuer_id, keyInfo[issuer_id] ?? {}))
        );
        enrichedKeyInfo = Object.fromEntries(
          keys.map((id, i): [string, IssuerListItem] => [id, enrichedEntries[i] as IssuerListItem])
        );
      }

      const issuers = this.api.keyInfoToArray<IssuerListItem>(
        { ...listResponse, key_info: enrichedKeyInfo },
        'issuer_id'
      );
      return {
        issuers: paginate(issuers, { page }),
        parentModel,
      };
    } catch (error) {
      const { status } = await this.api.parseError(error);
      if (status === 404) {
        return { parentModel };
      } else {
        throw error;
      }
    }
  }

  setupController(controller: RouteController, resolvedModel: IssuersIndexRouteModel) {
    super.setupController(controller, resolvedModel);
    const { currentPath } = this.secretMountPath;
    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: currentPath, route: 'overview', model: currentPath },
      { label: 'Issuers', route: 'issuers.index', model: currentPath },
    ];
  }

  resetController(controller: RouteController, isExiting: boolean) {
    if (isExiting) {
      controller.set('page', undefined);
    }
  }
}
