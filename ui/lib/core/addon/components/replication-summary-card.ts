/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { get } from '@ember/object';
import Component from '@glimmer/component';

/**
 * @module ReplicationSummaryCard
 * The `ReplicationSummaryCard` is a card-like component.  It displays cluster mode details for both DR and Performance
 *
 * @example
 * ```js
 * <ReplicationSummaryCard
    @title='States'
    @replicationDetails={DS.Model.replicationDetailsSummary}
    />
 * ```
 * @param {String} [title=null] - The title to be displayed on the top left corner of the card.
 * @param {Object} replicationDetails=null - An Ember data object computed off the Ember Model.  It combines the Model.dr and Model.performance objects into one and contains details specific to the mode replication.
 */

interface ReplicationSummaryCardArgs {
  title?: string;
  replicationDetails?: Record<string, unknown>;
}

export default class ReplicationSummaryCard extends Component<ReplicationSummaryCardArgs> {
  get key(): 'performance' | 'dr' {
    return this.args.title === 'Performance' ? 'performance' : 'dr';
  }
  get lastWAL(): unknown {
    return get(this.args.replicationDetails as Record<string, unknown>, `${this.key}.lastWAL`) || 0;
  }
  get merkleRoot(): unknown {
    return (
      get(this.args.replicationDetails as Record<string, unknown>, `${this.key}.merkleRoot`) ||
      'no hash found'
    );
  }
  get knownSecondariesCount(): unknown {
    return (
      get(this.args.replicationDetails as Record<string, unknown>, `${this.key}.knownSecondaries.length`) || 0
    );
  }
}
