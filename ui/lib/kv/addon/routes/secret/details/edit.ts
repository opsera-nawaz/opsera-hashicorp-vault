/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Route from '@ember/routing/route';
import { breadcrumbsForSecret } from 'kv/utils/kv-breadcrumbs';
import KvForm from 'vault/forms/secrets/kv';

import type Controller from '@ember/controller';
import type { Breadcrumb } from 'vault/app-types';
import type { DetailsRouteModel } from '../details';

interface RouteModel extends DetailsRouteModel {
  form: KvForm;
}

interface RouteController extends Controller {
  breadcrumbs: Breadcrumb[];
}

export default class KvSecretDetailsEditRoute extends Route {
  model(): RouteModel {
    const parentModel = this.modelFor('secret.details') as DetailsRouteModel;
    const { metadata, secret } = parentModel;
    const formData: {
      path: string;
      max_versions: number;
      options: { cas: number };
      secretData?: Record<string, string>;
    } = {
      path: parentModel.path,
      max_versions: 0,
      options: {
        // cas is only used to compare against the version saved server-side on submit; if both are
        // undefined (a brand new secret has neither) KvFormData still declares `cas` as required.
        cas: (metadata?.current_version || secret.version) as number,
      },
    };
    if (!parentModel.secret.failReadErrorCode) {
      // KvFormData's editor only supports string values; secretData's real values are unknown
      // since KV v2 secrets may store any JSON-serializable type.
      formData.secretData = parentModel.secret.secretData as Record<string, string> | undefined;
    }
    return {
      ...parentModel,
      form: new KvForm(formData),
    };
  }

  setupController(controller: RouteController, resolvedModel: RouteModel): void {
    super.setupController(controller, resolvedModel);

    controller.breadcrumbs = [
      { label: 'Vault', route: 'vault', icon: 'vault', linkExternal: true },
      { label: 'Secrets engines', route: 'secrets', linkExternal: true },
      { label: resolvedModel.backend, route: 'list', model: resolvedModel.backend },
      ...breadcrumbsForSecret(resolvedModel.backend, resolvedModel.path),
      { label: 'Edit' },
    ];
  }
}
