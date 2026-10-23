import assert from 'node:assert/strict';
import test from 'node:test';

import worker, { SENTINEL_SCREENING_VERSION } from '../src/index.js';

const ORIGIN = 'https://santiagojn.github.io';

test('health checks D1 without writing and reports the screening version', async () => {
  const calls = [];
  const env = {
    ALLOWED_ORIGINS: ORIGIN,
    DB: {
      prepare(query) {
        calls.push(query);
        return { first: async () => ({ ok: 1 }) };
      },
    },
  };
  const request = new Request('https://worker.example/health', {
    headers: { Origin: ORIGIN },
  });

  const response = await worker.fetch(request, env, {});
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.deepEqual(calls, ['SELECT 1 AS ok']);
  assert.deepEqual(body, {
    ok: true,
    service: 'perception-study-api',
    database: 'connected',
    sentinelScreeningVersion: SENTINEL_SCREENING_VERSION,
  });
});

test('health fails closed when D1 is unavailable', async () => {
  const env = {
    ALLOWED_ORIGINS: ORIGIN,
    DB: {
      prepare() {
        return { first: async () => { throw new Error('D1 unavailable'); } };
      },
    },
  };
  const request = new Request('https://worker.example/health', {
    headers: { Origin: ORIGIN },
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = await worker.fetch(request, env, {});
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    assert.equal(body.database, 'unavailable');
    assert.equal(body.sentinelScreeningVersion, SENTINEL_SCREENING_VERSION);
  } finally {
    console.error = originalConsoleError;
  }
});
