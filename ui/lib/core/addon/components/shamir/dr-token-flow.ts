/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { service } from '@ember/service';
import ShamirFlowComponent from './flow';

import type ApiService from 'vault/services/api';
import type { ShamirRequestData, ShamirFlowArgs, ShamirAttemptResponse } from './flow';

interface ShamirDrTokenFlowArgs extends ShamirFlowArgs {
  onCancel?: () => void;
}

/**
 * @module ShamirDrTokenFlowComponent
 * ShamirDrTokenFlow is an extension of the ShamirFlow component that does the Generate Action Token workflow inside of a Modal.
 * Please note, this is not an extensive list of the required parameters -- please see ShamirFlow for others
 *
 * @example
 * ```js
 * <Shamir::DrTokenFlow @action="generate-dr-operation-token" @onCancel={{this.closeModal}} />
 * ```
 * @param {string} action - required kebab-case-string which refers to an action within the cluster adapter
 * @param {function} onCancel - if provided, function will be triggered on Cancel
 */
export default class ShamirDrTokenFlowComponent extends ShamirFlowComponent<ShamirDrTokenFlowArgs> {
  @service declare readonly api: ApiService;

  @tracked generateWithPGP = false; // controls which form shows
  @tracked savedPgpKey: string | null = null;
  @tracked otp = '';
  @tracked askForPrimaryToken = false; // controls whether to show primary token input
  @tracked primaryRootToken: string | null = null; // stores the primary root token

  constructor(owner: unknown, args: ShamirDrTokenFlowArgs) {
    super(owner, args);
    // Don't fetch status on init - we'll check it after the user provides the primary token
    // Fetching status here would start an unauthenticated generation attempt
  }

  reset(): void {
    this.generateWithPGP = false;
    this.savedPgpKey = null;
    this.otp = '';
    this.askForPrimaryToken = false;
    this.primaryRootToken = null;
    // tracked items on Shamir/Flow
    this.attemptResponse = null;
    this.errors = null;
  }

  // Values calculated from the attempt response
  get encodedToken(): string | undefined {
    return this.attemptResponse?.encoded_token;
  }
  get started(): boolean | undefined {
    return this.attemptResponse?.started;
  }
  get nonce(): string | undefined {
    return this.attemptResponse?.nonce;
  }
  get progress(): number | undefined {
    return this.attemptResponse?.progress;
  }
  get threshold(): number | undefined {
    return this.attemptResponse?.required;
  }
  get pgpText() {
    return {
      confirm: `Below is the base-64 encoded PGP Key that will be used to encrypt the generated operation token.`,
      form: `Choose a PGP Key from your computer or paste the contents of one in the form below. This key will be used to Encrypt the generated operation token.`,
    };
  }

  // Methods which override those in Shamir/Flow
  extractData(data: ShamirRequestData): ShamirRequestData {
    if (this.started) {
      if (this.nonce) {
        data.nonce = this.nonce;
      }
      return data;
    }
    if (this.savedPgpKey) {
      return {
        pgp_key: this.savedPgpKey,
      };
    }
    // only if !started
    return {
      attempt: data.attempt,
    };
  }

  updateProgress(response: ShamirAttemptResponse | undefined): void {
    if (response?.otp) {
      // OTP is sticky -- once we get one we don't want to remove it
      // even if the current response doesn't include one.
      // See PR #5818
      this.otp = response.otp;
    }
    this.attemptResponse = response ?? null;
    return;
  }

  @action
  usePgpKey(keyfile: string): void {
    this.savedPgpKey = keyfile;
    // Don't start generation yet - show primary token form first
    this.generateWithPGP = false;
    this.askForPrimaryToken = true;
  }

  @action
  onSubmitKey(data: ShamirRequestData): void {
    // Override parent to pass primaryToken
    this.attemptProgress(this.extractData(data), this.primaryRootToken ?? undefined);
  }

  @action
  startGenerate(evt: Event): void {
    evt.preventDefault();
    // Show the primary token input form first
    this.askForPrimaryToken = true;
  }

  @action
  updatePrimaryRootToken(evt: Event): void {
    this.primaryRootToken = (evt.target as HTMLInputElement).value;
  }

  @action
  async validatePrimaryRootToken(): Promise<void> {
    if (!this.primaryRootToken) {
      this.errors = ['Primary root token is required'];
      return;
    }

    this.errors = null;

    try {
      // First, check status to validate the token without starting a new generation
      await this.attemptProgress(undefined, this.primaryRootToken);

      if (!this.started) {
        // No generation in progress, so start one
        await this.attemptProgress(this.extractData({ attempt: true }), this.primaryRootToken);

        // Check if there were errors from starting generation (e.g., invalid PGP key)
        if (this.errors) {
          return;
        }
      }

      // Only hide the primary token form if there were no errors
      this.askForPrimaryToken = false;
    } catch (e) {
      const err = e as { httpStatus?: number; message?: string };
      if (err.httpStatus === 403) {
        this.errors = ['Invalid primary root token. Please check the token and try again.'];
      } else {
        this.errors = [err.message || 'An error occurred while validating the token'];
      }
    }
  }

  @action
  backToPgpForm(): void {
    // Go back to PGP form and clear the saved PGP key
    this.askForPrimaryToken = false;
    this.generateWithPGP = true;
    this.savedPgpKey = null;
    this.errors = null;
  }

  @action
  async onCancelClose(): Promise<void> {
    if (!this.encodedToken && this.started) {
      // if primaryRootToken is not defined then make unauthenticated request
      const headers = this.api.buildHeaders({ token: this.primaryRootToken || '' });
      await this.api.sys.replicationDrSecondaryGenerateOperationTokenCancel(headers);
    }
    this.reset();
    if (this.args.onCancel) {
      this.args.onCancel();
    }
  }
}

/* generate-operation-token response example
{
  "started": true,
  "nonce": "2dbd10f1-8528-6246-09e7-82b25b8aba63",
  "progress": 1,
  "required": 3,
  "encoded_token": "",
  "otp": "2vPFYG8gUSW9npwzyvxXMug0",
  "otp_length": 24,
  "complete": false
}
*/
