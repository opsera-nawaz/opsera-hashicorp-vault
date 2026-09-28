/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

interface PgpKeyFile {
  value: string;
}

const pgpKeyFileDefault = (): PgpKeyFile => ({ value: '' });

interface ChoosePgpKeyFormArgs {
  onCancel: () => void;
  onSubmit: (pgpKey: string) => void;
  buttonText?: string;
  formText?: string;
}

/**
 * @module ChoosePgpKeyForm
 * ChoosePgpKeyForm component is used for DR Operation Token Generation workflow. It provides
 * an interface for the user to upload or paste a PGP key for use
 *
 * @example
 * <ChoosePgpKeyForm @onCancel={{log "cancel!"}} @onSubmit={{log "submit!"}} />
 *
 * @param {function} onCancel - required - This function will be triggered when the modal intends to be closed
 * @param {function} onSubmit - required - When the PGP key is confirmed, it will call this method with the pgpKey value as the only param
 * @param {string} buttonText - Button text for onSubmit. Defaults to "Continue with key"
 * @param {string} formText - Form text above where the users uploads or pastes the key. Has default
 */
export default class ChoosePgpKeyForm extends Component<ChoosePgpKeyFormArgs> {
  @tracked pgpKeyFile = pgpKeyFileDefault();
  @tracked selectedPgp = '';

  get pgpKey(): string {
    return this.pgpKeyFile.value;
  }

  get buttonText(): string {
    return this.args.buttonText || 'Continue with key';
  }

  get formText(): string {
    return (
      this.args.formText ||
      'Choose a PGP Key from your computer or paste the contents of one in the form below.'
    );
  }

  @action setKey(_: unknown, keyFile: PgpKeyFile): void {
    this.pgpKeyFile = keyFile;
  }

  // Form submit actions:
  @action usePgpKey(evt: Event): void {
    evt.preventDefault();
    this.selectedPgp = this.pgpKey;
  }
  @action handleSubmit(evt: Event): void {
    evt.preventDefault();
    this.args.onSubmit(this.pgpKey);
  }
}
