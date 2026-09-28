/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
import { ancestorKeysForKey, keyPartsForKey, keyWithoutParentKey } from 'core/utils/key-utils';
import { encodePath } from 'vault/utils/path-encoding-helpers';

/**
 * @module KeyValueHeader
 * KeyValueHeader components show breadcrumbs for secret engines.
 *
 * @example
 * <KeyValueHeader @path="vault.cluster.secrets.backend.show" @mode={{this.mode}}/>
 *
 * @param {string} [mode=null] - Used to set the currentPath.
 * @param {string} [baseKey=null] - Used to generate the path backward.
 * @param {string} [path=null] - The fallback path.
 * @param {string} [root=null] - Used to set the secretPath.
 * @param {boolean} [showCurrent=true] - Boolean to show the second part of the breadcrumb, ex: the secret's name.
 * @param {boolean} [linkToPaths=true] - If true link to the path.
 */

interface BaseKey {
  display?: string;
  id?: string;
}

interface KeyValueHeaderArgs {
  mode?: string | null;
  baseKey?: BaseKey | null;
  path?: string | null;
  root?: string | string[] | null;
  showCurrent?: boolean;
  linkToPaths?: boolean;
}

interface Crumb {
  label?: string;
  text?: string;
  path?: string | null;
  model?: string;
}

export default class KeyValueHeader extends Component<KeyValueHeaderArgs> {
  get showCurrent(): boolean {
    return this.args.showCurrent || true;
  }

  get linkToPaths(): boolean {
    return this.args.linkToPaths || true;
  }

  stripTrailingSlash(str: string): string {
    return str[str.length - 1] === '/' ? str.slice(0, -1) : str;
  }

  get currentPath(): string | null | undefined {
    if (!this.args.mode || this.showCurrent === false) {
      return this.args.path;
    }
    return `vault.cluster.secrets.backend.${this.args.mode}`;
  }

  get secretPath(): (string | Crumb)[] {
    const crumbs: (string | Crumb)[] = [];
    const root = this.args.root;
    const baseKey = this.args.baseKey?.display || this.args.baseKey?.id;
    const baseKeyModel = encodePath(this.args.baseKey?.id as string);

    if (root) {
      if (Array.isArray(root)) {
        crumbs.push(...root);
      } else {
        crumbs.push(root);
      }
    }

    if (!baseKey) {
      return crumbs;
    }

    const path = this.args.path;
    const currentPath = this.currentPath;
    const showCurrent = this.showCurrent;
    const ancestors = ancestorKeysForKey(baseKey);
    const parts = keyPartsForKey(baseKey);
    if (ancestors.length === 0) {
      crumbs.push({
        label: baseKey,
        text: this.stripTrailingSlash(baseKey),
        path: currentPath,
        model: baseKeyModel,
      });

      if (!showCurrent) {
        crumbs.pop();
      }

      return crumbs;
    }

    ancestors.forEach((ancestor, index) => {
      crumbs.push({
        // non-null: `ancestors.length > 0` (checked above) is only possible
        // when `keyPartsForKey(baseKey)` also returned a non-null array
        label: parts![index],
        text: this.stripTrailingSlash(parts![index] as string),
        path: path,
        model: encodePath(ancestor),
      });
    });

    crumbs.push({
      // non-null: `baseKey` is truthy here (checked above), so
      // keyWithoutParentKey's `key ? ... : null` always takes the non-null branch
      label: keyWithoutParentKey(baseKey)!,
      text: this.stripTrailingSlash(keyWithoutParentKey(baseKey)!),
      path: currentPath,
      model: baseKeyModel,
    });

    if (!showCurrent) {
      crumbs.pop();
    }

    return crumbs;
  }
}
