/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Ember from 'ember';
import Component from '@glimmer/component';
import { service } from '@ember/service';
import { action } from '@ember/object';
import keys from 'core/utils/keys';
import { keyIsFolder, parentKeyForKey, keyWithoutParentKey } from 'core/utils/key-utils';
import { tracked } from '@glimmer/tracking';
import { task, timeout } from 'ember-concurrency';

import type RouterService from '@ember/routing/router-service';

interface Args {
  mountPoint: string;
  filterValue: string;
}

/**
 * @module KvListFilter
 * `KvListFilter` is used for filtering on the KV metadata LIST response.
 * It allows users to search for any text, and will transition to the list
 * page with the appropriate parameters depending on the query. This component
 * expects that the component will be re-constructed after search, since the
 * route will reload the model and completely refresh the page.
 *  *
 * <KvListFilter
 *  @mountPoint={{this.model.mountPoint}}
 *  @filterValue="beep/my-"
 * />
 * @param {string} mountPoint - Where in the router files we're located. For this component it will always be vault.cluster.secrets.backend.kv
 * @param {string} filterValue - Full initial search value. A concatenation between the list-directory's dynamic path "path-to-secret" and the queryParam "pageFilter". For example, if we're inside the beep/ directory searching for any secret that starts with "my-" this value will equal "beep/my-".
 */

export default class KvListFilterComponent extends Component<Args> {
  @service('app-router') declare readonly router: RouterService;
  @tracked query: string | undefined;

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    this.query = this.args.filterValue;
  }

  navigate(pathToSecret?: string | null, pageFilter?: string | null): void {
    const route = pathToSecret ? `${this.args.mountPoint}.list-directory` : `${this.args.mountPoint}.list`;
    const queryParams = { queryParams: { pageFilter: pageFilter ? pageFilter : null } };
    if (pathToSecret) {
      this.router.transitionTo(route, pathToSecret, queryParams);
    } else {
      this.router.transitionTo(route, queryParams);
    }
  }

  @action
  handleKeyDown(event: KeyboardEvent): void {
    const isEscKeyPressed = keys.ESC.includes(event.key);
    if (isEscKeyPressed) {
      // On escape, transition to the nearest parentDirectory.
      // If no parentDirectory, then to the list route.
      const input = (event.target as HTMLInputElement).value;
      const parentDirectory = parentKeyForKey(input);
      if (!parentDirectory) {
        this.navigate();
      } else {
        this.navigate(parentDirectory);
      }
    }
    // ignore all other key events
  }

  @action handleInput(evt: Event): void {
    this.query = (evt.target as HTMLInputElement).value;
  }

  @task
  *handleSearch(evt: Event) {
    evt.preventDefault();
    // shows loader to indicate that the search was executed
    yield timeout(Ember.testing ? 0 : 250);
    const searchTerm = this.query ?? '';
    const isDirectory = keyIsFolder(searchTerm);
    const parentDirectory = parentKeyForKey(searchTerm);
    const secretWithinDirectory = keyWithoutParentKey(searchTerm);
    if (isDirectory) {
      this.navigate(searchTerm);
    } else if (parentDirectory) {
      this.navigate(parentDirectory, secretWithinDirectory);
    } else {
      this.navigate(null, searchTerm);
    }
  }
}
