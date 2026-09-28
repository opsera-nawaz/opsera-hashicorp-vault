/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model, { attr } from '@ember-data/model';
import { set, get } from '@ember/object';
import clamp from 'vault/utils/clamp';
import lazyCapabilities, { apiPath, type CapabilitiesPathProxy } from 'vault/macros/lazy-capabilities';

interface ActionValue {
  isSupported: boolean | string;
  description: string;
  glyph: string;
}

const ACTION_VALUES: Record<string, ActionValue> = {
  encrypt: {
    isSupported: 'supportsEncryption',
    description: 'Looks up wrapping properties for the given token.',
    glyph: 'lock-fill',
  },
  decrypt: {
    isSupported: 'supportsDecryption',
    description: 'Decrypts the provided ciphertext using this key.',
    glyph: 'mail-open',
  },
  datakey: {
    isSupported: 'supportsEncryption',
    description: 'Generates a new key and value encrypted with this key.',
    glyph: 'key',
  },
  rewrap: {
    isSupported: 'supportsEncryption',
    description: 'Rewraps the ciphertext using the latest version of the named key.',
    glyph: 'reload',
  },
  sign: {
    isSupported: 'supportsSigning',
    description: 'Get the cryptographic signature of the given data.',
    glyph: 'pencil-tool',
  },
  hmac: {
    isSupported: true,
    description: 'Generate a data digest using a hash algorithm.',
    glyph: 'shuffle',
  },
  verify: {
    isSupported: true,
    description: 'Validate the provided signature for the given data.',
    glyph: 'check-circle',
  },
  export: {
    isSupported: 'exportable',
    description: 'Get the named key.',
    glyph: 'external-link',
  },
};

export default class TransitKeyModel extends Model {
  @attr('string') declare backend: string | undefined;
  @attr('string', {
    defaultValue: 'aes256-gcm96',
  })
  declare type: string;

  @attr('string', {
    label: 'Name',
    readOnly: true,
  })
  declare name: string | undefined;

  @attr({
    defaultValue: '0',
    defaultShown: 'Key is not automatically rotated',
    editType: 'ttl',
    label: 'Auto-rotation period',
  })
  declare autoRotatePeriod: string;

  @attr('boolean') declare deletionAllowed: boolean | undefined;
  @attr('boolean') declare derived: boolean | undefined;
  @attr('boolean') declare exportable: boolean | undefined;

  @attr('number', {
    defaultValue: 1,
  })
  declare minDecryptionVersion: number;

  @attr('number', {
    defaultValue: 0,
  })
  declare minEncryptionVersion: number;

  @attr('number') declare latestVersion: number | undefined;
  @attr('object') declare keys: Record<string, unknown> | undefined;
  @attr('boolean') declare convergentEncryption: boolean | undefined;
  @attr('number') declare convergentEncryptionVersion: number | undefined;

  @attr('boolean') declare supportsSigning: boolean | undefined;
  @attr('boolean') declare supportsEncryption: boolean | undefined;
  @attr('boolean') declare supportsDecryption: boolean | undefined;
  @attr('boolean') declare supportsDerivation: boolean | undefined;

  setConvergentEncryption(val: boolean): void {
    if (val) {
      set(this, 'derived', val);
    }
    set(this, 'convergentEncryption', val);
  }

  setDerived(val: boolean): void {
    if (!val) {
      set(this, 'convergentEncryption', val);
    }
    set(this, 'derived', val);
  }

  get supportedActions(): Array<{ name: string; description: string; glyph: string }> {
    return Object.keys(ACTION_VALUES)
      .filter((name) => {
        const { isSupported } = ACTION_VALUES[name]!;
        return typeof isSupported === 'boolean' || get(this, isSupported as never);
      })
      .map((name) => {
        const { description, glyph } = ACTION_VALUES[name]!;
        return { name, description, glyph };
      });
  }

  get keyVersions(): number[] {
    let maxVersion = Math.max(...this.validKeyVersions.map(Number));
    const versions: number[] = [];
    while (maxVersion > 0) {
      versions.unshift(maxVersion);
      maxVersion--;
    }
    return versions;
  }

  get encryptionKeyVersions(): number[] {
    const { keyVersions, minDecryptionVersion } = this;

    return keyVersions
      .filter((version) => {
        return version >= minDecryptionVersion;
      })
      .reverse();
  }

  get keysForEncryption(): number[] {
    let { minEncryptionVersion, latestVersion } = this;
    latestVersion = latestVersion ?? 0;
    const minVersion = clamp(minEncryptionVersion - 1, 0, latestVersion);
    const versions: number[] = [];
    while (latestVersion > minVersion) {
      versions.push(latestVersion);
      latestVersion--;
    }
    return versions;
  }

  get validKeyVersions(): string[] {
    return Object.keys(this.keys ?? {});
  }

  get exportKeyTypes(): string[] {
    const types = ['hmac'];
    if (this.supportsSigning) {
      types.unshift('signing');
    }
    if (this.supportsEncryption) {
      types.unshift('encryption');
    }
    return types;
  }
  @lazyCapabilities(apiPath`${'backend'}/keys/${'id'}/rotate`, 'backend', 'id')
  declare rotatePath: CapabilitiesPathProxy;
  @lazyCapabilities(apiPath`${'backend'}/keys/${'id'}`, 'backend', 'id')
  declare secretPath: CapabilitiesPathProxy;

  get canRotate(): boolean {
    return this.rotatePath.get('canUpdate');
  }
  get canRead(): boolean {
    return this.secretPath.get('canUpdate');
  }
  get canUpdate(): boolean {
    return this.secretPath.get('canUpdate');
  }
  get canDelete(): boolean {
    // there's more to just a permissions check here.
    // must also check if there's a property on the key called deletionAllowed that is set to true
    const deleteAttrChanged = Boolean(
      (this.changedAttributes() as Record<string, unknown>)['deletionAllowed']
    );
    const keyAllowedDeletion = this.deletionAllowed && !deleteAttrChanged;
    return this.secretPath.get('canDelete') && !!keyAllowedDeletion;
  }

  get canEdit(): boolean {
    return this.secretPath.get('canUpdate');
  }
}
