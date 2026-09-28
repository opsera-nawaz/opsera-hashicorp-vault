/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { action } from '@ember/object';
import { service } from '@ember/service';
import { camelize } from '@ember/string';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import type ApiService from 'vault/services/api';

// The Shamir adapter response shape is dynamic across unseal and DR
// operation-token-generation flows (see the two example payloads at the
// bottom of this file) - modeled loosely as a superset of both, since
// consumers only ever read a handful of known-optional fields off it.
export interface ShamirAttemptResponse {
  data?: ShamirAttemptResponse;
  errors?: string[];
  complete?: boolean;
  sealed?: boolean;
  t?: number;
  n?: number;
  progress?: number;
  version?: string;
  cluster_name?: string;
  cluster_id?: string;
  started?: boolean;
  nonce?: string;
  required?: number;
  encoded_token?: string;
  otp?: string;
  otp_length?: number;
  [key: string]: unknown;
}

export interface ShamirRequestData {
  nonce?: string;
  pgp_key?: string;
  attempt?: boolean;
  [key: string]: unknown;
}

export interface ShamirFlowArgs {
  action: string;
  threshold?: number;
  progress?: number;
  inputLabel?: string;
  buttonText?: string;
  extractData?: (data: ShamirRequestData) => ShamirRequestData;
  updateProgress?: () => void;
  checkComplete?: (response: ShamirAttemptResponse) => boolean;
  onShamirSuccess?: () => void;
  onLicenseError?: () => void;
}

/**
 * @module ShamirFlowComponent
 * These components are used to manage keeping track of a shamir unseal flow.
 * This component is generic and can be overwritten for various shamir use cases.
 * The lifecycle for a Shamir flow is as follows:
 * 1. Start (optional)
 * 2. Attempt progress
 * 3. Check progress
 * 4. Check complete
 *
 * @example
 * ```js
 * <Shamir::Flow
 *  @action="unseal"
 *  @threshold={{5}}
 *  @progress={{3}}
 *  @onShamirSuccess={{transition-to "vault.cluster"}}
 * />
 * ```
 *
 * @param {string} action - adapter method name (kebab case) to call on attempt
 * @param {number} threshold - number of keys required to unlock
 * @param {number} progress - number of keys given so far for unlock
 * @param {string} inputLabel - (optional) Label for key input
 * @param {string} buttonText - (optional) CTA for the form submit button. Defaults to "Submit"
 * @param {Function} extractData - (optional) modify the payload before the action is called
 * @param {Function} updateProgress - (optional) call a side effect to check if progress has been made
 * @param {Function} checkComplete - (optional) custom logic based on adapter response. Should return boolean.
 * @param {Function} onShamirSuccess - method called when shamir unlock is complete.
 * @param {Function} onLicenseError - method called when shamir unlock fails due to licensing error
 *
 */
export default class ShamirFlowComponent<
  Args extends ShamirFlowArgs = ShamirFlowArgs,
> extends Component<Args> {
  @service declare readonly api: ApiService;

  @tracked errors: string[] | null = null;
  @tracked attemptResponse: ShamirAttemptResponse | null = null;

  get action(): string {
    if (!this.args.action) return '';
    return camelize(this.args.action);
  }

  extractData(data: ShamirRequestData): ShamirRequestData {
    if (this.args.extractData) {
      // custom data extraction
      return this.args.extractData(data);
    }

    // This method can be overwritten by extended components
    // to control what data is passed into the method action
    if (this.attemptResponse?.nonce) {
      data.nonce = this.attemptResponse.nonce;
    }
    return data;
  }

  /**
   * 2. Attempt progress. This method assumes the correct data
   * has already been extracted (use this.extractData to customize)
   * @param {object} data arbitrary data which will be passed to adapter method
   * @param {string} primaryToken optional primary root token for DR secondary operations
   * @returns Promise which should resolve unless throwing error to parent.
   */
  async attemptProgress(data?: ShamirRequestData, primaryToken?: string): Promise<void> {
    try {
      this.errors = null;
      let response: ShamirAttemptResponse | undefined;
      const headers = this.api.buildHeaders({ token: primaryToken || '' });

      if (this.args.action === 'generate-dr-operation-token') {
        if (!data) {
          // check status
          response = (await this.api.sys.replicationDrSecondaryGenerateOperationTokenReadProgress(
            headers
          )) as unknown as ShamirAttemptResponse;
        } else if (data.pgp_key || data.attempt) {
          // initialize a new generate-operation-token attempt
          response = (await this.api.sys.replicationDrSecondaryGenerateOperationTokenInitialize(
            data as never,
            headers
          )) as unknown as ShamirAttemptResponse;
        } else {
          // progress the operation
          response = (await this.api.sys.replicationDrSecondaryGenerateOperationTokenUpdate(
            data as never,
            headers
          )) as unknown as ShamirAttemptResponse;
        }
      } else if (this.args.action === 'unseal') {
        // request.put's 3rd param is raw HeadersInit, unlike the sys.* methods
        // above which take the { headers } wrapper buildHeaders() returns
        const resp = await this.api.request.put('/sys/unseal', data, headers.headers);
        response = (await resp.json()) as ShamirAttemptResponse;
      }
      this.updateProgress(response?.data || response);
      this.handleComplete(response?.data || response);
    } catch (e) {
      const { status, response } = await this.api.parseError(e);
      if (status === 400) {
        this.errors = response?.errors ?? null;
      } else {
        // if licensing error, trigger parent method to handle
        if (status === 500 && response?.errors?.join(' ').includes('licensing is in an invalid state')) {
          this.args.onLicenseError?.();
        }
        throw e;
      }
    }
  }

  /**
   * 3. This method gets called after successful unseal attempt.
   * By default the response will be made available to the component,
   * but pass in @updateProgress (no params) to trigger any side effects that will
   * update passed attributes from parent.
   * @param {payload} response from the adapter method
   * @returns void
   */
  updateProgress(response: ShamirAttemptResponse | undefined): void {
    if (this.args.updateProgress) {
      this.args.updateProgress();
    }
    this.attemptResponse = response ?? null;
    return;
  }

  /**
   * 4. checkComplete checks the payload for completeness, then then
   * takes calls @onShamirSuccess with no arguments if complete.
   * For custom logic, define @checkComplete which receives the
   * adapter payload.
   * @param {payload} response from the adapter method
   * @returns void
   */
  handleComplete(response: ShamirAttemptResponse | undefined): void {
    const isComplete = this.checkComplete(response);
    if (isComplete) {
      if (this.args.onShamirSuccess) {
        this.args.onShamirSuccess();
      }
    }
    return;
  }

  checkComplete(response: ShamirAttemptResponse | undefined): boolean {
    if (this.args.checkComplete) {
      return this.args.checkComplete(response as ShamirAttemptResponse);
    }
    return response?.complete === true;
  }

  reset(): void {
    this.attemptResponse = null;
    this.errors = null;
  }

  @action
  onSubmitKey(data: ShamirRequestData): void {
    this.attemptProgress(this.extractData(data));
  }
}

/* example unseal response (progress)
{
  "sealed": true,
  "t": 3,
  "n": 5,
  "progress": 2,
  "version": "0.6.2"
}

example unseal response (finished)
{
  "sealed": false,
  "t": 3,
  "n": 5,
  "progress": 0,
  "version": "0.6.2",
  "cluster_name": "vault-cluster-d6ec3c7f",
  "cluster_id": "3e8b3fec-3749-e056-ba41-b62a63b997e8"
}
*/
