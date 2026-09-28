/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { service } from '@ember/service';
import Helper from '@ember/component/helper';

import type FlashMessageService from 'vault/services/flash-messages';

type FlashMessageType = 'success' | 'warning' | 'info' | 'danger' | 'alert' | 'secondary';

export default class SetFlashMessageHelper extends Helper {
  @service declare readonly flashMessages: FlashMessageService;

  compute([message, type]: [string, FlashMessageType?]): () => void {
    return () => {
      this.flashMessages[type || 'success'](message);
    };
  }
}
