/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import AdapterError from '@ember-data/adapter/error';
import RESTAdapter from '@ember-data/adapter/rest';
import { service } from '@ember/service';
import { set } from '@ember/object';
import RSVP from 'rsvp';
import config from '../config/environment';

import type Service from '@ember/service';
import type AuthService from 'vault/services/auth';
import type NamespaceService from 'vault/services/namespace';
import type ControlGroupService from 'vault/services/control-group';
import type { ApiResponse } from 'vault/api';

const { APP } = config;
const { POLLING_URLS, NAMESPACE_ROOT_URLS } = APP;

interface AjaxOptions {
  clientToken?: string;
  unauthenticated?: boolean;
  wrapTTL?: string;
  namespace?: string;
  skipWarnings?: boolean;
  headers?: Record<string, string>;
  timeout?: number;
  body?: BodyInit | null;
  signal?: AbortSignal | null;
  [key: string]: unknown;
}

interface AjaxResponse {
  warnings?: string[];
  [key: string]: unknown;
}

export default class ApplicationAdapter extends RESTAdapter {
  @service declare auth: AuthService;
  @service('namespace') declare namespaceService: NamespaceService;
  @service declare controlGroup: ControlGroupService;

  @service declare flashMessages: Service & { info: (message: string) => void };

  namespace = 'v1/sys';

  shouldReloadAll(): boolean {
    return true;
  }

  shouldReloadRecord(): boolean {
    return true;
  }

  shouldBackgroundReloadRecord(): boolean {
    return false;
  }

  addHeaders(url: string, options: AjaxOptions, method: string): void {
    const token = options.clientToken || this.auth.currentToken;
    const headers: Record<string, string> = {};
    if (token && !options.unauthenticated) {
      headers['X-Vault-Token'] = token;
    }
    if (options.wrapTTL) {
      headers['X-Vault-Wrap-TTL'] = options.wrapTTL;
    }
    if (method === 'PATCH') {
      headers['Content-Type'] = 'application/merge-patch+json';
    }
    const namespace =
      typeof options.namespace === 'undefined' ? this.namespaceService.path : options.namespace;
    if (namespace && !NAMESPACE_ROOT_URLS.some((str: string) => url.includes(str))) {
      headers['X-Vault-Namespace'] = namespace;
    }
    options.headers = Object.assign(options.headers || {}, headers);
  }

  _preRequest(url: string, options: AjaxOptions, method?: string): AjaxOptions {
    this.addHeaders(url, options, method ?? '');
    const isPolling = POLLING_URLS.some((str: string) => url.includes(str));
    if (!isPolling) {
      this.auth.setLastFetch(Date.now());
    }
    options.timeout = 60000;
    return options;
  }

  // Return type matches the upstream `RESTAdapter#ajax` signature (`RSVP.Promise<any>`) verbatim:
  // every adapter in this codebase calls `this.ajax(...).then((resp: SpecificShape) => ...)` with its
  // own response shape, which is only possible if the resolved value here stays as permissive as the
  // base class declares it (narrowing to `unknown` would break every one of those call sites).
  ajax(intendedUrl: string, method: string, passedOptions: AjaxOptions = {}): RSVP.Promise<any> {
    let url = intendedUrl;
    let type = method;
    let options = passedOptions;
    const controlGroup = this.controlGroup;
    const controlGroupToken = controlGroup.tokenForUrl(url);
    // if we have a Control Group token that matches the intendedUrl,
    // then we want to unwrap it and return the unwrapped response as
    // if it were the initial request
    // To do this, we rewrite the function args
    if (controlGroupToken) {
      url = '/v1/sys/wrapping/unwrap';
      type = 'POST';
      options = {
        clientToken: controlGroupToken.token,
        data: {
          token: controlGroupToken.token,
        },
      };
    }
    const opts = this._preRequest(url, options, method);

    return super.ajax(url, type, opts).then((...args: [AjaxResponse, ...unknown[]]) => {
      if (controlGroupToken) {
        controlGroup.deleteControlGroupToken(controlGroupToken.accessor);
      }
      const [resp] = args;
      if (resp && resp.warnings && !options.skipWarnings) {
        const flash = this.flashMessages;
        resp.warnings.forEach((message: string) => {
          flash.info(message);
        });
      }
      return controlGroup.checkForControlGroup(args, resp as unknown as ApiResponse, options.wrapTTL);
    });
  }

  // for use on endpoints that don't return JSON responses
  rawRequest(url: string, type?: string, options: AjaxOptions = {}): Promise<Response> {
    const opts = this._preRequest(url, options);
    return fetch(url, {
      method: type || 'GET',
      headers: opts.headers || {},
      body: opts.body,
      signal: opts.signal,
    }).then((response) => {
      if (response.status >= 200 && response.status < 300) {
        return RSVP.resolve(response);
      } else {
        return RSVP.reject(response);
      }
    });
  }

  handleResponse(
    status: number,
    headers: Record<string, unknown>,
    payload: { data?: { error?: string }; errors?: unknown[] } | undefined,
    requestData: { url: string }
  ) {
    const returnVal = super.handleResponse(status, headers, payload ?? {}, requestData);
    if (returnVal instanceof AdapterError) {
      // ember data errors don't have the status code, so we add it here
      set(returnVal, 'httpStatus', status);
      set(returnVal, 'path', requestData.url);
      // Most of the time when the Vault API returns an error, the payload looks like:
      // { errors: ['some error message']}
      // But sometimes (eg RespondWithStatusCode) it looks like this:
      // { data: { error: 'some error message' } }
      if (payload?.data?.error && !payload.errors) {
        // Normalize the errors from RespondWithStatusCode
        set(returnVal, 'errors', [payload.data.error]);
      }
    }
    return returnVal;
  }
}
