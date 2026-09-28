/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Model, { attr, belongsTo, hasMany } from '@ember-data/model';
import { service } from '@ember/service';
import { get } from '@ember/object';

import type Service from '@ember/service';
import type NodeModel from 'vault/models/node';
import type ReplicationAttributesModel from 'vault/models/replication-attributes';

interface ClusterLicense {
  expiry_time?: string;
  state?: string;
  [key: string]: unknown;
}

export default class ClusterModel extends Model {
  @service declare version: Service;

  @hasMany('nodes', { async: false, inverse: null }) declare nodes: NodeModel[];
  @attr('string') declare name: string | undefined;
  @attr('string') declare status: string | undefined;
  @attr('boolean') declare standby: boolean | undefined;
  @attr('string') declare type: string | undefined;
  @attr('object') declare license: ClusterLicense | undefined;

  // manually set on response in cluster adapter
  @attr('boolean') declare hasChrootNamespace: boolean | undefined;
  @attr('boolean') declare replicationRedacted: boolean | undefined;

  /* Licensing concerns */
  get licenseExpiry(): string | undefined {
    return this.license?.expiry_time;
  }
  get licenseState(): string | undefined {
    return this.license?.state;
  }

  get needsInit(): boolean {
    return this.nodes.every((node) => {
      return node.initialized === false;
    });
  }

  get unsealed(): boolean {
    return !!this.nodes.find((node) => {
      return node.sealed === false;
    });
  }

  get sealed(): boolean {
    return !this.unsealed;
  }

  get leaderNode(): NodeModel | undefined {
    const nodes = this.nodes;
    if (nodes.length === 1) {
      return nodes[0];
    } else {
      return nodes.find((node) => node.isLeader);
    }
  }

  get sealThreshold(): number | undefined {
    return this.leaderNode?.sealThreshold;
  }
  get sealProgress(): number | undefined {
    return this.leaderNode?.progress;
  }
  get sealType(): string | undefined {
    return this.leaderNode?.type;
  }
  get storageType(): string | undefined {
    return this.leaderNode?.storageType;
  }
  get hcpLinkStatus(): string | undefined {
    return this.leaderNode?.hcpLinkStatus;
  }
  get hasProgress(): boolean {
    return (this.sealProgress ?? 0) >= 1;
  }
  get usingRaft(): boolean {
    return this.storageType === 'raft';
  }

  //replication mode - will only ever be 'unsupported'
  //otherwise the particular mode will have the relevant mode attr through replication-attributes
  // eg dr.mode or performance.mode
  @attr('string')
  declare mode: string | undefined;
  get allReplicationDisabled(): boolean | undefined {
    return this.dr?.replicationDisabled && this.performance?.replicationDisabled;
  }
  get anyReplicationEnabled(): boolean | undefined {
    return this.dr?.replicationEnabled || this.performance?.replicationEnabled;
  }

  @belongsTo('replication-attributes', { async: false, inverse: null })
  declare dr: ReplicationAttributesModel;
  @belongsTo('replication-attributes', { async: false, inverse: null })
  declare performance: ReplicationAttributesModel;
  // this service exposes what mode the UI is currently viewing
  // replicationAttrs will then return the relevant `replication-attributes` model
  @service('replication-mode') declare rm: Service & { mode?: string };
  get drMode(): string | undefined {
    return this.dr.mode;
  }
  get replicationMode(): string | undefined {
    return this.rm.mode;
  }
  get replicationModeForDisplay(): 'Disaster recovery' | 'Performance' {
    return this.replicationMode === 'dr' ? 'Disaster recovery' : 'Performance';
  }
  get replicationIsInitializing(): boolean {
    // a mode of null only happens when a cluster is being initialized
    // otherwise the mode will be 'disabled', 'primary', 'secondary'
    return !this.dr?.mode || !this.performance?.mode;
  }
  get replicationAttrs(): ReplicationAttributesModel | null {
    const replicationMode = this.replicationMode;
    return replicationMode ? (get(this, replicationMode) as ReplicationAttributesModel) : null;
  }
}
