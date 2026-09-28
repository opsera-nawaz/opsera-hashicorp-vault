/**
 * Copyright IBM Corp. 2016, 2026
 * SPDX-License-Identifier: BUSL-1.1
 */
import Ember from 'ember';
import Controller from '@ember/controller';
import { task, timeout } from 'ember-concurrency';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';

import type SecretMountPath from 'vault/services/secret-mount-path';
import type { TidyStatus } from 'pki/routes/tidy/index';

const POLL_INTERVAL_MS = 5000;

export default class PkiTidyIndexController extends Controller {
  @service declare readonly secretMountPath: SecretMountPath;

  @tracked tidyStatus: TidyStatus | null = null;

  declare notConfiguredMessage: string;
  // assigned by PkiTidyIndexRoute#setupController; see the route for a note on `this` binding
  declare fetchTidyStatus: () => Promise<TidyStatus>;

  // this task is cancelled by resetController() upon leaving the pki.tidy.index route
  @task
  *pollTidyStatus(): Generator<unknown, void, unknown> {
    while (true) {
      // when testing, the polling loop causes promises to never settle so acceptance tests hang
      // to get around that, we just disable the poll in tests
      if (Ember.testing) {
        return;
      }
      yield timeout(POLL_INTERVAL_MS);
      try {
        const tidyStatusResponse = yield this.fetchTidyStatus();
        this.tidyStatus = tidyStatusResponse as TidyStatus;
      } catch {
        // we want to keep polling here
      }
    }
  }
}
