/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

/**
 * Loose, non-generic stand-ins for ember-data's `ModelSchema<K>`/`Snapshot<K>` types.
 *
 * The real types are generic over `K extends keyof ModelRegistry` and every adapter method on
 * `@ember-data/adapter`'s base classes is *itself* generic per-call (`findRecord<K>(...)`). Once
 * `ModelRegistry` has explicit (non-catch-all) entries, overriding those methods with a concrete,
 * non-generic parameter type trips TS2416 ("not assignable to the same property in base type"),
 * and passing the *real* `ModelSchema`/`Snapshot` (which then default their generic to the full
 * union of every registered model name) collapses call sites like `store.serializerFor(modelName)`
 * to `never` via distributive-conditional-type weirdness.
 *
 * Every adapter here only ever reads `.modelName`/`.id`/`.record`/`.attr()`/`.adapterOptions` off
 * these objects, so a plain structural type is sufficient and sidesteps both problems.
 */
export interface AdapterModelSchema {
  modelName: string;
}

export interface AdapterSnapshot {
  id: string;
  modelName: string;
  record: Record<string, unknown>;
  adapterOptions: Record<string, unknown>;
  attr(key: string): unknown;
  eachAttribute(callback: (key: string, meta: { options?: Record<string, unknown> }) => void): void;
  eachRelationship(callback: (key: string, meta: { kind: string }) => void, binding?: unknown): void;
  serialize(options?: unknown): unknown;
}

/**
 * Loose stand-in for `store.serializerFor(modelName)`'s return type. Passing `modelName as never`
 * (see above) makes the *real* generic `serializerFor<K>` infer `K = never`, which collapses its
 * return type to `never` too — so the result of every `store.serializerFor(...)` call here needs
 * casting to this instead of being used directly.
 */
export interface AdapterSerializer {
  serialize(snapshot: unknown, options?: unknown): unknown;
  normalizeResponse(
    store: unknown,
    modelClass: unknown,
    payload: unknown,
    id: unknown,
    requestType: string
  ): unknown;
  primaryKey: string;
}
