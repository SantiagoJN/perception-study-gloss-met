import assert from 'node:assert/strict';
import test from 'node:test';

import { persistResultFallback } from '../src/index.js';

const SECRET = 'test-signing-secret-with-sufficient-entropy';

function base64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

async function token(claims) {
  const body = base64Url(Buffer.from(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `${body}.${base64Url(new Uint8Array(signature))}`;
}

function completedPayload() {
  const answers = ['A', 'B', 'A', 'B', 'A'];
  return {
    schemaVersion: '2026-10-20.5',
    sessionId: 'session-for-r2-test',
    studyType: 'forcedChoice',
    startedAt: '2026-10-20T10:00:00.000Z',
    completedAt: '2026-10-20T10:08:00.000Z',
    consented: true,
    consentedAt: '2026-10-20T10:00:05.000Z',
    assignmentBatch: 'set_03',
    inhouse: false,
    demographicsSkipped: false,
    demographics: {
      sexAssignedAtBirth: 'prefer_not_to_say',
      genderIdentity: 'prefer_not_to_say',
      education: 'doctorate',
      normalOrCorrectedVision: 'yes',
      backgroundExperience: ['none'],
    },
    trainingAttempts: [],
    clientMetadata: { userAgent: 'fallback-test' },
    trials: [
      {
        trialNumber: 1,
        trialId: '=formula-like-id',
        responseTimeMs: 500,
        isSentinel: false,
        response: { selectedOption: 'A' },
      },
      ...answers.map((selectedOption, index) => ({
        trialNumber: index + 2,
        trialId: `SENTINEL_T2_0${index + 1}`,
        responseTimeMs: 1000 + index,
        isSentinel: true,
        sentinelId: `SENTINEL_T2_0${index + 1}`,
        response: { selectedOption },
      })),
    ],
  };
}

function privateBucket() {
  const objects = new Map();
  let puts = 0;
  return {
    objects,
    get puts() { return puts; },
    async head(key) { return objects.get(key)?.metadata ?? null; },
    async put(key, value, options) {
      puts += 1;
      objects.set(key, {
        value,
        options,
        metadata: { customMetadata: options.customMetadata },
      });
    },
  };
}

async function fallbackRequest(payload, claims = {}) {
  const signed = await token({
    sid: payload.sessionId,
    cid: 42,
    st: payload.studyType,
    inh: false,
    batch: 'set_03',
    run: null,
    exp: Math.floor(Date.now() / 1000) + 600,
    ...claims,
  });
  return new Request('https://worker.example/api/v1/submit', {
    method: 'POST',
    headers: { Authorization: `Bearer ${signed}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

test('a valid failed D1 write is stored once as a confirmed private CSV backup', async () => {
  const payload = completedPayload();
  const bucket = privateBucket();
  const env = { SESSION_SIGNING_SECRET: SECRET, RESULTS_FALLBACK: bucket };

  const first = await persistResultFallback(await fallbackRequest(payload), env, 'completed', 'd1_test_failure');
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  assert.equal(firstBody.storage, 'r2');
  assert.equal(firstBody.fallbackStored, true);
  assert.equal(firstBody.screenedOut, false);
  assert.match(firstBody.receiptId, /^r2-[0-9a-f]{20}$/);
  assert.equal(bucket.puts, 1);
  assert.equal(bucket.objects.size, 1);

  const [{ value, options }] = [...bucket.objects.values()];
  assert.equal(options.httpMetadata.contentType, 'text/csv; charset=utf-8');
  assert.equal(options.customMetadata.trialCount, '6');
  assert.equal(value.trimEnd().split('\r\n').length, 7);
  assert.match(value, /"'=formula-like-id"/);
  assert.match(value, /"r2_private_fallback"/);

  const second = await persistResultFallback(await fallbackRequest(payload), env, 'completed', 'd1_test_failure');
  const secondBody = await second.json();
  assert.equal(second.status, 200);
  assert.equal(secondBody.alreadyStored, true);
  assert.equal(secondBody.receiptId, firstBody.receiptId);
  assert.equal(bucket.puts, 1);
});

test('the private fallback rejects a different payload for an existing session', async () => {
  const payload = completedPayload();
  const bucket = privateBucket();
  const env = { SESSION_SIGNING_SECRET: SECRET, RESULTS_FALLBACK: bucket };
  await persistResultFallback(await fallbackRequest(payload), env, 'completed', 'd1_test_failure');
  payload.trials[0].response.selectedOption = 'B';
  const conflict = await persistResultFallback(await fallbackRequest(payload), env, 'completed', 'd1_test_failure');
  assert.equal(conflict.status, 409);
  assert.equal(bucket.puts, 1);
});

test('the private fallback requires a valid scoped session token', async () => {
  const payload = completedPayload();
  const bucket = privateBucket();
  const env = { SESSION_SIGNING_SECRET: SECRET, RESULTS_FALLBACK: bucket };
  const request = await fallbackRequest(payload, { st: 'pairJudgment' });
  const response = await persistResultFallback(request, env, 'completed', 'd1_test_failure');
  assert.equal(response.status, 400);
  assert.equal(bucket.puts, 0);
});

test('the private fallback will not store a result without recorded consent', async () => {
  const payload = completedPayload();
  delete payload.consentedAt;
  const bucket = privateBucket();
  const env = { SESSION_SIGNING_SECRET: SECRET, RESULTS_FALLBACK: bucket };
  const response = await persistResultFallback(await fallbackRequest(payload), env, 'completed', 'd1_test_failure');
  assert.equal(response.status, 400);
  assert.equal(bucket.puts, 0);
});
