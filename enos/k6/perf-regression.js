// Copyright IBM Corp. 2016, 2025
// SPDX-License-Identifier: BUSL-1.1

// perf-regression.js is the k6 load-generation script for the WO-053
// performance regression scenario (enos/enos-scenario-benchmark.hcl,
// "run_perf_regression" step). It exercises the four endpoints named in the
// WO-053 acceptance criteria:
//
//   1. GET  /v1/sys/health              (100 VUs, 5m by default)
//   2. POST /v1/secret/data/perf-test   (50 VUs, 5m by default) -- KV write
//   3. GET  /v1/secret/data/perf-test   (50 VUs, 5m by default) -- KV read
//   4. POST /v1/transit/encrypt/perf-key (50 VUs, 5m by default)
//
// and captures p50/p95/p99/max latency for each. The first PERF_WARMUP_SECONDS
// (default 30s) of each scenario's samples are excluded from the recorded
// Trend metrics -- cold-start latency is not representative of steady-state
// performance and would bias the comparison against enos/benchmarks/baseline.json
// (see WO-053 edge_cases). handleSummary() writes the result in the same
// "endpoints" shape used by enos/benchmarks/baseline.json and latest.json so
// enos/scripts/compare-benchmarks.sh can consume it directly.
//
// This script is self-sufficient: setup() mounts kv-v2 at secret/ and creates
// the transit perf-key (aes256-gcm96, matching the key type FIPS mode
// requires post WO-042) if they don't already exist, so it can run standalone
// against a freshly provisioned Enos cluster with no external harness.
//
// All configuration is via environment variables so the same script serves
// both the full-scale Enos/CI run (AC5 defaults) and a scaled-down local run.
import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import encoding from 'k6/encoding';

const VAULT_ADDR = (__ENV.VAULT_ADDR || 'http://127.0.0.1:8200').replace(/\/$/, '');
const VAULT_TOKEN = __ENV.VAULT_TOKEN || 'root';
const INSECURE_TLS = (__ENV.PERF_INSECURE_TLS || 'true') === 'true';

const WARMUP_MS = (parseInt(__ENV.PERF_WARMUP_SECONDS, 10) || 30) * 1000;
const DURATION = __ENV.PERF_DURATION || '5m';

const HEALTH_VUS = parseInt(__ENV.PERF_HEALTH_VUS, 10) || 100;
const WRITE_VUS = parseInt(__ENV.PERF_WRITE_VUS, 10) || 50;
const READ_VUS = parseInt(__ENV.PERF_READ_VUS, 10) || 50;
const ENCRYPT_VUS = parseInt(__ENV.PERF_ENCRYPT_VUS, 10) || 50;

// Optional baseline p99 values (milliseconds), supplied by the Enos
// comparison step so k6's own thresholds fail fast during the run itself,
// ahead of the more detailed enos/scripts/compare-benchmarks.sh report.
// Left at 0 (disabled) for standalone/local runs that have no baseline yet.
const HEALTH_P99_BASELINE_MS = parseFloat(__ENV.PERF_HEALTH_P99_BASELINE_MS || '0');
const WRITE_P99_BASELINE_MS = parseFloat(__ENV.PERF_KV_WRITE_P99_BASELINE_MS || '0');
const READ_P99_BASELINE_MS = parseFloat(__ENV.PERF_KV_READ_P99_BASELINE_MS || '0');
const ENCRYPT_P99_BASELINE_MS = parseFloat(__ENV.PERF_TRANSIT_ENCRYPT_P99_BASELINE_MS || '0');
const REGRESSION_MULTIPLIER = 1.05; // AC3: p99 must stay within 5% of baseline

const summaryTrendStats = ['avg', 'min', 'med', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'];

export const healthDuration = new Trend('vault_sys_health_duration', true);
export const kvWriteDuration = new Trend('vault_kv_write_duration', true);
export const kvReadDuration = new Trend('vault_kv_read_duration', true);
export const transitEncryptDuration = new Trend('vault_transit_encrypt_duration', true);

const authHeaders = {
  'X-Vault-Token': VAULT_TOKEN,
  'Content-Type': 'application/json',
};

function thresholdFor(baselineMs) {
  return baselineMs > 0 ? [`p(99)<${baselineMs * REGRESSION_MULTIPLIER}`] : [];
}

export const options = {
  insecureSkipTLSVerify: INSECURE_TLS,
  summaryTrendStats: summaryTrendStats,
  scenarios: {
    sys_health: {
      executor: 'constant-vus',
      exec: 'sysHealth',
      vus: HEALTH_VUS,
      duration: DURATION,
    },
    kv_write: {
      executor: 'constant-vus',
      exec: 'kvWrite',
      vus: WRITE_VUS,
      duration: DURATION,
    },
    kv_read: {
      executor: 'constant-vus',
      exec: 'kvRead',
      vus: READ_VUS,
      duration: DURATION,
    },
    transit_encrypt: {
      executor: 'constant-vus',
      exec: 'transitEncrypt',
      vus: ENCRYPT_VUS,
      duration: DURATION,
    },
  },
  thresholds: {
    vault_sys_health_duration: thresholdFor(HEALTH_P99_BASELINE_MS),
    vault_kv_write_duration: thresholdFor(WRITE_P99_BASELINE_MS),
    vault_kv_read_duration: thresholdFor(READ_P99_BASELINE_MS),
    vault_transit_encrypt_duration: thresholdFor(ENCRYPT_P99_BASELINE_MS),
  },
};

// setup() runs once, before any VU starts. It provisions the mounts/key this
// script depends on and seeds one KV entry so kv_read never races kv_write's
// first sample. Every call tolerates "already exists" so re-running against
// an already-provisioned cluster (e.g. the Enos benchmark scenario re-run)
// is a no-op, not a failure.
export function setup() {
  http.post(
    `${VAULT_ADDR}/v1/sys/mounts/secret`,
    JSON.stringify({ type: 'kv', options: { version: '2' } }),
    { headers: authHeaders },
  );
  http.post(`${VAULT_ADDR}/v1/sys/mounts/transit`, JSON.stringify({ type: 'transit' }), {
    headers: authHeaders,
  });
  http.post(
    `${VAULT_ADDR}/v1/transit/keys/perf-key`,
    JSON.stringify({ type: 'aes256-gcm96' }),
    { headers: authHeaders },
  );
  http.post(
    `${VAULT_ADDR}/v1/secret/data/perf-test`,
    JSON.stringify({ data: { seed: 'wo-053-warmup-seed' } }),
    { headers: authHeaders },
  );
  return { testStart: Date.now() };
}

function pastWarmup(data) {
  return Date.now() - data.testStart >= WARMUP_MS;
}

function randomString(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

export function sysHealth(data) {
  const res = http.get(`${VAULT_ADDR}/v1/sys/health`, { tags: { name: 'sys_health' } });
  check(res, {
    'health responded': (r) => [200, 429, 472, 473, 501, 503].includes(r.status),
  });
  if (pastWarmup(data)) {
    healthDuration.add(res.timings.duration);
  }
}

export function kvWrite(data) {
  const body = JSON.stringify({ data: { value: randomString(64), vu: __VU, iter: __ITER } });
  const res = http.post(`${VAULT_ADDR}/v1/secret/data/perf-test`, body, {
    headers: authHeaders,
    tags: { name: 'kv_write' },
  });
  check(res, { 'kv write ok': (r) => r.status === 200 });
  if (pastWarmup(data)) {
    kvWriteDuration.add(res.timings.duration);
  }
}

export function kvRead(data) {
  const res = http.get(`${VAULT_ADDR}/v1/secret/data/perf-test`, {
    headers: authHeaders,
    tags: { name: 'kv_read' },
  });
  check(res, { 'kv read ok': (r) => r.status === 200 });
  if (pastWarmup(data)) {
    kvReadDuration.add(res.timings.duration);
  }
}

export function transitEncrypt(data) {
  const plaintext = encoding.b64encode(randomString(128));
  const body = JSON.stringify({ plaintext: plaintext });
  const res = http.post(`${VAULT_ADDR}/v1/transit/encrypt/perf-key`, body, {
    headers: authHeaders,
    tags: { name: 'transit_encrypt' },
  });
  check(res, { 'transit encrypt ok': (r) => r.status === 200 });
  if (pastWarmup(data)) {
    transitEncryptDuration.add(res.timings.duration);
  }
}

// handleSummary reshapes k6's end-of-run metrics into the "endpoints" schema
// shared by enos/benchmarks/baseline.json and latest.json, so
// enos/scripts/compare-benchmarks.sh needs no k6-specific parsing logic.
// It writes to stdout (captured by the Enos comparison step) and, when
// PERF_SUMMARY_PATH is set, to a file -- useful for local/manual capture runs.
export function handleSummary(data) {
  const pick = (metricName) => {
    const m = data.metrics[metricName];
    const values = (m && m.values) || {};
    return {
      p50_ms: round2(values['p(50)']),
      p95_ms: round2(values['p(95)']),
      p99_ms: round2(values['p(99)']),
      max_ms: round2(values['max']),
    };
  };

  const endpoints = {
    sys_health: Object.assign(
      { method: 'GET', path: '/v1/sys/health' },
      pick('vault_sys_health_duration'),
    ),
    kv_write: Object.assign(
      { method: 'POST', path: '/v1/secret/data/perf-test' },
      pick('vault_kv_write_duration'),
    ),
    kv_read: Object.assign(
      { method: 'GET', path: '/v1/secret/data/perf-test' },
      pick('vault_kv_read_duration'),
    ),
    transit_encrypt: Object.assign(
      { method: 'POST', path: '/v1/transit/encrypt/perf-key' },
      pick('vault_transit_encrypt_duration'),
    ),
  };

  const load_profile = {
    sys_health_vus: HEALTH_VUS,
    kv_write_vus: WRITE_VUS,
    kv_read_vus: READ_VUS,
    transit_encrypt_vus: ENCRYPT_VUS,
    duration: DURATION,
    warmup_seconds: WARMUP_MS / 1000,
  };

  const out = { endpoints: endpoints, load_profile: load_profile };
  const files = {
    stdout: JSON.stringify(out, null, 2) + '\n',
  };
  if (__ENV.PERF_SUMMARY_PATH) {
    files[__ENV.PERF_SUMMARY_PATH] = JSON.stringify(out, null, 2) + '\n';
  }
  return files;
}

function round2(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) {
    return null;
  }
  return Math.round(n * 100) / 100;
}
