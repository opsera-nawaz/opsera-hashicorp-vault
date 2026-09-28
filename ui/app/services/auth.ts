/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Ember from 'ember';
import { task, timeout } from 'ember-concurrency';
import { getOwner } from '@ember/owner';
import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { capitalize } from '@ember/string';

import getStorage from 'vault/lib/token-storage';
import ENV from 'vault/config/environment';
import { addToArray } from 'vault/helpers/add-to-array';

import type Owner from '@ember/owner';
import type RouterService from '@ember/routing/router-service';
import type Store from '@ember-data/store';
import type CurrentClusterService from 'vault/services/current-cluster';
import type NamespaceService from 'vault/services/namespace';
import type PermissionsService from 'vault/services/permissions';
import type { TokenStorage } from 'vault/lib/token-storage';
import type { NormalizedAuthData } from 'vault/auth/form';
import type { AuthResponseAuthKey, AuthResponseDataKey } from 'vault/auth/methods';
import type {
  MfaRequirementApiResponse,
  ParsedMfaRequirement,
  ParsedMfaConstraint,
  ParsedMfaMethod,
} from 'vault/auth/mfa';

export const TOKEN_SEPARATOR = '☃';
export const TOKEN_PREFIX = 'vault-';
export const ROOT_PREFIX = '_root_';

// Data shape returned by an auth method's login response (or the normalized
// equivalent produced by normalizeAuthData) that persistAuthData consumes.
export interface AuthResponseData {
  authMethodType: string;
  authMountPath: string;
  entityId?: string;
  policies?: string[];
  renewable?: boolean;
  token: string;
  ttl?: number | null;
  displayName?: string;
  expireTime?: string;
  namespacePath?: string;
  mfaRequirement?: MfaRequirementApiResponse | null;
}

// Shape written to token storage. Adds the fields computed during persistence
// on top of the raw auth response data.
export interface PersistedTokenData extends AuthResponseData {
  userRootNamespace: string;
  tokenExpirationEpoch: number | null;
  ttl: number | null;
}

// Subset of auth data used to fill in details missing from a login response
// (i.e. resolved via a token lookup-self call).
export interface TokenLookupData {
  displayName?: string;
  expireTime?: string;
  namespacePath?: string;
}

export interface AuthSuccessResponse {
  namespace: string;
  token: string; // the name of the token in local storage, not the actual token
  isRoot: boolean;
}

interface NormalizeAuthDataProperties {
  authMethodType: string;
  authMountPath: string;
  displayName?: string;
  token?: string;
  ttl?: number;
}

interface ActiveClusterModel {
  name?: string;
  needsInit?: boolean;
  sealed?: boolean;
  replicationRedacted?: boolean;
  dr?: { isSecondary?: boolean } | null;
  [key: string]: unknown;
}

// Shape submitted to the mfa/validate endpoint, built by MfaConstraint#validateData --
// distinct from ParsedMfaRequirement, which is the shape parseMfaResponse returns for
// display in the MFA selection UI.
interface MfaValidateRequirement {
  mfa_request_id: string;
  mfa_constraints: Array<{
    methods: ParsedMfaMethod[];
    passcode: string;
    selectedMethod: ParsedMfaMethod | undefined;
  }>;
}

interface ClusterAdapter {
  mfaValidate(mfaRequirement: MfaValidateRequirement): Promise<{ auth: AuthResponseAuthKey }>;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export default class AuthService extends Service {
  @service declare readonly permissions: PermissionsService;
  @service declare readonly currentCluster: CurrentClusterService;
  @service declare readonly router: RouterService;
  @service declare readonly store: Store;
  @service('namespace') declare readonly namespaceService: NamespaceService;

  IDLE_TIMEOUT = 3 * 60e3;
  @tracked expirationCalcTS: number | null = null;
  @tracked isRenewing = false;
  @tracked mfaErrors: string[] | null = null;
  @tracked isRootToken = false;
  @tracked allowExpiration = false;
  @tracked activeClusterId?: string;
  @tracked lastFetch?: number;
  @tracked private _tokens?: string[];

  get tokenExpired(): boolean | null {
    const expiration = this.tokenExpirationDate;
    return expiration ? this.now() >= expiration : null;
  }

  get activeCluster(): ActiveClusterModel | null {
    return this.currentCluster.cluster;
  }

  get tokens(): string[] {
    return this._tokens || this.getTokensFromStorage() || [];
  }

  set tokens(value: string[]) {
    this._tokens = value;
  }

  get isActiveSession(): boolean {
    if (this.activeCluster) {
      if (this.activeCluster.dr?.isSecondary || this.activeCluster.needsInit || this.activeCluster.sealed) {
        return false;
      }
      if (
        this.activeCluster.name &&
        this.currentToken &&
        this.router.currentRouteName !== 'vault.cluster.auth'
      ) {
        return true;
      }
    }
    return false;
  }

  // returns the key for the token to use
  get currentTokenName(): string | undefined {
    const regex = new RegExp(this.activeClusterId ?? '');
    return this.tokens.find((key) => regex.test(key));
  }

  get currentToken(): string | null {
    const name = this.currentTokenName;
    const data = name ? this.getTokenData(name) : undefined;
    return name && data ? data.token : null;
  }

  get authData(): PersistedTokenData | null | undefined {
    const token = this.currentTokenName;
    if (!token) {
      return;
    }
    const stored = this.getTokenData(token);
    return stored ? Object.assign({}, stored) : null;
  }

  get tokenExpirationDate(): number | null | undefined {
    const tokenName = this.currentTokenName;
    if (!tokenName) {
      return;
    }
    const tokenData = this.getTokenData(tokenName);
    const tokenExpirationEpoch = tokenData ? tokenData.tokenExpirationEpoch : undefined;
    const expirationDate = new Date(0); // Creates a "zeroed" date object

    return tokenExpirationEpoch ? expirationDate.setUTCMilliseconds(tokenExpirationEpoch) : null;
  }

  get renewAfterEpoch(): number | null {
    const tokenName = this.currentTokenName;
    const { expirationCalcTS } = this;
    if (!tokenName || !expirationCalcTS) {
      return null;
    }
    const data = this.getTokenData(tokenName);
    if (!data) {
      return null;
    }
    const { ttl, renewable } = data;
    // renew after last expirationCalc time + half of the ttl (in ms)
    return renewable ? Math.floor(((ttl ?? 0) * 1e3) / 2) + expirationCalcTS : null;
  }

  constructor(owner?: Owner) {
    super(owner);
    this.checkForRootToken();
  }

  clusterAdapter(): ClusterAdapter {
    return getOwner(this)?.lookup('adapter:cluster') as ClusterAdapter;
  }

  generateTokenName(
    { backend, clusterId }: { backend: string; clusterId: string },
    policies?: string[]
  ): string {
    return (policies || []).includes('root')
      ? `${TOKEN_PREFIX}${ROOT_PREFIX}${TOKEN_SEPARATOR}${clusterId}`
      : `${TOKEN_PREFIX}${backend}${TOKEN_SEPARATOR}${clusterId}`;
  }

  backendFromTokenName(tokenName: string): string {
    return tokenName.includes(`${TOKEN_PREFIX}${ROOT_PREFIX}`)
      ? 'token'
      : tokenName.slice(TOKEN_PREFIX.length).split(TOKEN_SEPARATOR)[0] ?? '';
  }

  storage(tokenName?: string): TokenStorage {
    if (
      tokenName &&
      tokenName.indexOf(`${TOKEN_PREFIX}${ROOT_PREFIX}`) === 0 &&
      this.environment() !== 'development'
    ) {
      return getStorage('memory');
    } else {
      return getStorage();
    }
  }

  environment(): string {
    return ENV.environment;
  }

  now(): number {
    return Date.now();
  }

  setCluster(clusterId: string): void {
    this.activeClusterId = clusterId;
  }

  ajax<T = unknown>(
    url: string,
    method: HttpMethod,
    options: { headers?: Record<string, string>; namespace?: string } = {}
  ): Promise<T> {
    const defaults: { url: string; method: HttpMethod; dataType: string; headers: Record<string, string> } = {
      url,
      method,
      dataType: 'json',
      headers: {
        'X-Vault-Token': this.currentToken ?? '',
      },
    };

    const namespace =
      typeof options.namespace === 'undefined' ? this.namespaceService.path : options.namespace;
    if (namespace) {
      defaults.headers['X-Vault-Namespace'] = namespace;
    }
    const opts = Object.assign(defaults, options);

    return fetch(url, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }).then((response) => {
      if (response.status === 204) {
        return undefined;
      } else if (response.status >= 200 && response.status < 300) {
        return response.json();
      } else {
        throw response;
      }
    });
  }

  renewCurrentToken(): Promise<{ auth: AuthResponseAuthKey }> {
    const { userRootNamespace } = this.authData as PersistedTokenData;
    const url = '/v1/auth/token/renew-self';
    return this.ajax<{ auth: AuthResponseAuthKey }>(url, 'POST', { namespace: userRootNamespace });
  }

  async lookupSelf(
    token: string
  ): Promise<{ data: { display_name?: string; namespace_path?: string; expire_time?: string } }> {
    return this.store
      .adapterFor('application')
      .ajax('/v1/auth/token/lookup-self', 'GET', { headers: { 'X-Vault-Token': token } });
  }

  revokeCurrentToken(): Promise<unknown> {
    const { userRootNamespace } = this.authData as PersistedTokenData;
    const url = '/v1/auth/token/revoke-self';
    return this.ajax(url, 'POST', { namespace: userRootNamespace });
  }

  // ttl is originally either the "ttl" or "lease_duration" returned by the auth data response
  calculateExpiration({
    now,
    ttl,
    expireTime,
  }: {
    now: number;
    ttl: number | null | undefined;
    expireTime?: string | null;
  }): { ttl: number | null; tokenExpirationEpoch: number | null } {
    // First check if the ttl is falsy, including 0, before converting to milliseconds.
    // Obviously a ttl of zero seconds is not recommended, but root tokens have a `0` ttl because they never expire.
    // Note - this is different from mount configurations where a `ttl: 0` actually means the value is "unset" and to use system defaults.
    const convertToMilliseconds = () => (ttl ? now + ttl * 1e3 : null);
    const tokenExpirationEpoch = expireTime ? new Date(expireTime).getTime() : convertToMilliseconds();
    // To avoid confusion, if a TTL is `0` return null
    return { ttl: ttl || null, tokenExpirationEpoch };
  }

  setExpirationSettings(renewable: boolean | undefined, now: number): void {
    if (renewable) {
      this.expirationCalcTS = now;
      this.allowExpiration = false;
    } else {
      this.allowExpiration = true;
    }
  }

  calculateRootNamespace(
    currentNamespace: string,
    namespacePath: string | undefined,
    backend: string
  ): string {
    // namespace_path is only returned for methods that use a token exchange to authenticate (i.e. token, oidc)
    // here we prefer namespace_path if its defined,
    // else we look and see if there's already a namespace saved
    // and then finally we'll use the current query param if the others
    // haven't set a value yet
    // all of the typeof checks are necessary because the root namespace is ''
    let userRootNamespace: string | undefined = namespacePath && namespacePath.replace(/\/$/, '');
    // renew-self does not return namespace_path, so we manually setting in renew().
    // so if we're logging in with token and there's no namespace_path, we can assume
    // that the token belongs to the root namespace
    if (backend === 'token' && !userRootNamespace) {
      userRootNamespace = '';
    }
    const authData = this.authData;
    if (typeof userRootNamespace === 'undefined' && authData) {
      userRootNamespace = authData.userRootNamespace;
    }
    if (typeof userRootNamespace === 'undefined') {
      userRootNamespace = currentNamespace;
    }
    return userRootNamespace;
  }

  async persistAuthData(clusterId: string, authResponseData: AuthResponseData): Promise<AuthSuccessResponse> {
    // An empty string denotes the "root" namespace
    const currentNamespace = this.namespaceService.path || '';
    // Only pull out the necessary data
    const { authMethodType, authMountPath, entityId, policies, renewable, token, ttl } = authResponseData;

    // Lookup token for additional data that may be missing from the method's login response
    const { displayName, expireTime, namespacePath } = await this.lookupTokenData(token, !!currentNamespace, {
      displayName: authResponseData?.displayName,
      expireTime: authResponseData?.expireTime,
      namespacePath: authResponseData?.namespacePath,
    });

    const userRootNamespace = this.calculateRootNamespace(currentNamespace, namespacePath, authMethodType);

    // Set stored ttl and tokenExpirationEpoch
    const now = this.now();
    const { ttl: calculatedTtl, tokenExpirationEpoch } = this.calculateExpiration({ now, ttl, expireTime });

    const persistedTokenData: PersistedTokenData = {
      authMethodType,
      authMountPath,
      displayName: displayName || authMethodType,
      entityId,
      policies,
      renewable,
      token,
      ttl: calculatedTtl,
      tokenExpirationEpoch,
      userRootNamespace,
      // Only include namespacePath if it exists
      ...(namespacePath && { namespacePath }),
    };

    this.setExpirationSettings(renewable, now);
    // ensure we don't call renew-self within tests
    // this is intentionally not included in setExpirationSettings so we can unit test that method
    if (Ember.testing) this.allowExpiration = false;

    // Set token name and store data
    const tokenName = this.generateTokenName({ backend: authMethodType, clusterId }, policies);
    this.tokens = addToArray(this.tokens, tokenName) as string[];
    this.setTokenData(tokenName, persistedTokenData);
    return Promise.resolve({
      namespace: currentNamespace || persistedTokenData.userRootNamespace,
      token: tokenName,
      isRoot: (policies || []).includes('root'),
    });
  }

  async lookupTokenData(
    token: string,
    hasNamespace: boolean,
    { displayName, expireTime, namespacePath }: TokenLookupData
  ): Promise<TokenLookupData> {
    // Only lookup if we're missing displayName or namespacePath in a non-root namespace
    if (!displayName || (!namespacePath && hasNamespace)) {
      try {
        const { data } = await this.lookupSelf(token);
        return {
          displayName: displayName || data?.display_name,
          namespacePath: namespacePath || data?.namespace_path,
          expireTime: expireTime || data?.expire_time,
        };
      } catch {
        // It would be unusual for this request to fail, but swallowing it because we're
        // essentially setting "nice to have" data here.
      }
    }
    // Return original values as fallback
    return { displayName, namespacePath, expireTime };
  }

  setTokenData(token: string, data: PersistedTokenData): void {
    this.storage(token).setItem(token, data);
  }

  getTokenData(token: string): PersistedTokenData | undefined {
    return this.storage(token).getItem(token) as PersistedTokenData | undefined;
  }

  removeTokenData(token: string): void {
    this.storage(token).removeItem(token);
  }

  renew(): Promise<AuthSuccessResponse> | undefined {
    const currentlyRenewing = this.isRenewing;
    if (currentlyRenewing) return;

    this.isRenewing = true;
    return this.renewCurrentToken().then(
      async (resp) => {
        this.isRenewing = false;
        // If we renewing, authData already exists so all we really need to update are the token and expiration details
        const { authMethodType, authMountPath, displayName } = this.authData as PersistedTokenData;
        const normalizedAuthData = this.normalizeAuthData(resp.auth, {
          authMethodType,
          authMountPath,
          displayName,
        });
        return await this.persistAuthData(this.activeClusterId as string, normalizedAuthData);
      },
      (e: unknown) => {
        this.isRenewing = false;
        throw e;
      }
    );
  }

  // `.on('init')` requires the classic TaskProperty API, which (per ember-concurrency's
  // types) only generator task functions return -- an async arrow function here would
  // resolve to a plain Task with no `.on()` modifier.
  checkShouldRenew = task(function* (this: AuthService) {
    while (true) {
      if (Ember.testing) {
        return;
      }
      yield timeout(5000);
      if (this.shouldRenew()) {
        yield this.renew();
      }
    }
  }).on('init');

  shouldRenew(): boolean {
    const now = this.now();
    const lastFetch = this.lastFetch;
    // renewAfterEpoch is a unix timestamp of login time + half of ttl
    const renewTime = this.renewAfterEpoch;
    if (!this.currentTokenName || this.tokenExpired || this.allowExpiration || !renewTime) {
      return false;
    }
    if (lastFetch && now - lastFetch >= this.IDLE_TIMEOUT) {
      this.allowExpiration = true;
      return false;
    }
    if (now >= renewTime) {
      return true;
    }
    return false;
  }

  setLastFetch(timestamp: number): void {
    const now = this.now();
    this.lastFetch = timestamp;
    // if expiration was allowed and we're over half the ttl we want to go ahead and renew here
    if (this.allowExpiration && this.renewAfterEpoch && now >= this.renewAfterEpoch) {
      this.renew();
    }
    this.allowExpiration = false;
  }

  getTokensFromStorage(filterFn?: (key: string) => boolean): string[] {
    return this.storage()
      .keys()
      .filter((key) => key.indexOf(TOKEN_PREFIX) === 0 && !(filterFn && filterFn(key)));
  }

  checkForRootToken(): void {
    if (this.environment() === 'development') {
      return;
    }

    this.getTokensFromStorage().forEach((key) => {
      const data = this.getTokenData(key);
      if (data?.policies?.includes('root')) {
        this.removeTokenData(key);
      }
    });
  }

  parseMfaResponse(mfaRequirement: MfaRequirementApiResponse): ParsedMfaRequirement {
    // mfa_requirement response comes back in a shape that is not easy to work with
    // convert to array of objects and add necessary properties to satisfy the view
    if (mfaRequirement) {
      const { mfa_request_id, mfa_constraints } = mfaRequirement;
      const constraints: ParsedMfaConstraint[] = [];
      for (const key in mfa_constraints) {
        const methods = mfa_constraints[key]?.any as ParsedMfaMethod[] | undefined;
        // friendly label for display in MfaForm
        methods?.forEach((m) => {
          const typeFormatted = m.type === 'totp' ? m.type.toUpperCase() : capitalize(m.type);
          m.label = `${typeFormatted} ${m.uses_passcode ? 'passcode' : 'push notification'}`;
        });
        constraints.push({ name: key, methods: methods ?? [], selectedMethod: null });
      }
      return { mfa_request_id, mfa_constraints: constraints };
    }
    return {} as ParsedMfaRequirement;
  }

  async totpValidate({
    clusterId,
    mfaRequirement,
    authMethodType,
    authMountPath,
  }: {
    clusterId: string;
    mfaRequirement: MfaValidateRequirement;
    authMethodType: string;
    authMountPath: string;
  }): Promise<AuthSuccessResponse> {
    // mfa/validate consistently returns data inside the "auth" key
    const { auth } = await this.clusterAdapter().mfaValidate(mfaRequirement);
    const normalizedAuthData = this.normalizeAuthData(auth, { authMethodType, authMountPath });
    return this.authSuccess(clusterId, normalizedAuthData);
  }

  async authSuccess(clusterId: string, authResponse: NormalizedAuthData): Promise<AuthSuccessResponse> {
    // persist selectedAuth to localStorage to rehydrate auth form on logout
    localStorage.setItem('selectedAuth', authResponse.authMethodType);
    const authData = await this.persistAuthData(clusterId, authResponse);
    this.permissions.getPaths.perform();
    return authData;
  }

  getAuthType(): string | null {
    // check localStorage first
    const selectedAuth = localStorage.getItem('selectedAuth');
    if (selectedAuth) return selectedAuth;
    // fallback to authData which discerns backend type from token
    return this.authData ? this.authData.authMethodType : null;
  }

  deleteCurrentToken(): void {
    const tokenName = this.currentTokenName;
    if (!tokenName) return;
    this.deleteToken(tokenName);
    this.removeTokenData(tokenName);
  }

  deleteToken(tokenName: string): void {
    const tokenNames = this.tokens.filter((name) => name !== tokenName);
    this.removeTokenData(tokenName);
    this.tokens = tokenNames;
  }

  // Depending on where auth happens (mfa/validate, renew-self or the method's login) the auth data
  // varies slightly (i.e. "ttl" vs "lease_duration"). Normalize it so stored authData contains consistent keys.
  // (Also, the API service returns camel cased keys and raw ajax requests return snake cased params.)
  normalizeAuthData(
    authData: Partial<AuthResponseAuthKey & AuthResponseDataKey>,
    { authMethodType, authMountPath, displayName, token, ttl }: NormalizeAuthDataProperties
  ): NormalizedAuthData {
    const displayNameFromMetadata = (metadata?: Record<string, string>): string =>
      metadata
        ? ['org', 'username']
            .map((key) => (key in metadata ? metadata[key] : null))
            .filter(Boolean)
            .join('/')
        : '';

    return {
      authMethodType,
      authMountPath,
      entityId: authData?.entity_id,
      expireTime: authData?.expire_time,
      token: token || authData?.client_token,
      renewable: authData?.renewable,
      ttl: ttl || authData?.lease_duration,
      policies: authData?.policies,
      mfaRequirement: authData?.mfa_requirement,
      // not all methods return a display name or metadata, if this is still empty it will be gleaned from lookup-self
      displayName: displayName || displayNameFromMetadata(authData?.metadata),
    } as NormalizedAuthData;
  }
}
