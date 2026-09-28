/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { service } from '@ember/service';
import Component from '@glimmer/component';
import { task } from 'ember-concurrency';

import type FlashMessageService from 'vault/services/flash-messages';

interface ListItemModel {
  rollbackAttributes(): void;
  [key: string]: unknown;
}

interface ListItemArgs {
  linkParams?: unknown[];
}

export default class ListItemComponent extends Component<ListItemArgs> {
  @service declare readonly flashMessages: FlashMessageService;

  @task
  *callMethod(
    method: string,
    model: ListItemModel,
    successMessage: string,
    failureMessage: string,
    successCallback: () => void = () => {}
  ): Generator<unknown, void, unknown> {
    const flash = this.flashMessages;
    try {
      yield (model[method] as () => unknown)();
      flash.success(successMessage);
      successCallback();
    } catch (e) {
      const errString = (e as { errors: string[] }).errors.join(' ');
      flash.danger(failureMessage + ' ' + errString);
      model.rollbackAttributes();
    }
  }
  get link(): { route?: unknown; models?: unknown[] } {
    if (!Array.isArray(this.args.linkParams) || !this.args.linkParams.length) return {};
    const [route, ...models] = this.args.linkParams;
    return { route, models };
  }
}
