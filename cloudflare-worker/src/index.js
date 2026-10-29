const STUDY_TYPES = new Set(['pairJudgment', 'forcedChoice', 'sceneMatching', 'contextMatching2', 'selection']);
const INTERNAL_USERNAMES = new Set(['gilab-inhouse', 'gilab-testing']);
const encoder = new TextEncoder();
const DUMMY_SALT = 'bWlzc2luZy1jcmVkZW50aWFsLXNhbHQ=';
const DUMMY_HASH = new Uint8Array(32);
export function sentinelScreenOutThreshold(studyType) {
  return studyType === 'selection' ? 3 : 2;
}
const SENTINEL_COUNT = 5;
export const SENTINEL_SCREENING_VERSION = '2026-10-23.1';
const PAIR_SENTINEL_ANSWERS = new Map([
  ['SENTINEL_T1_01', { sameMaterialLikelihood: 1, canonicalGlossChoice: 1 }],
  ['SENTINEL_T1_02', { sameMaterialLikelihood: 1, canonicalGlossChoice: -1, canonicalMetalChoice: -1 }],
  ['SENTINEL_T1_03', { sameMaterialLikelihood: 5, canonicalGlossChoice: 0, canonicalMetalChoice: 0 }],
  ['SENTINEL_T1_04', { sameMaterialLikelihood: 1, canonicalMetalChoice: -1 }],
  ['SENTINEL_T1_05', { sameMaterialLikelihood: 5, canonicalGlossChoice: 0, canonicalMetalChoice: 0 }],
]);
const FORCED_SENTINEL_ANSWERS = new Map([
  ['SENTINEL_T2_01', 'A'],
  ['SENTINEL_T2_02', 'B'],
  ['SENTINEL_T2_03', 'A'],
  ['SENTINEL_T2_04', 'B'],
  ['SENTINEL_T2_05', 'A'],
]);
const SCENE_SENTINEL_ANSWERS = new Map([
  ['SENTINEL_T3_01', 1],
  ['SENTINEL_T3_02', 2],
  ['SENTINEL_T3_03', 3],
  ['SENTINEL_T3_04', 2],
  ['SENTINEL_T3_05', 1],
]);
const CONTEXT2_SENTINEL_ANSWERS = new Map([
  ['SENTINEL_T32_01', 1],
  ['SENTINEL_T32_02', 2],
  ['SENTINEL_T32_03', 1],
  ['SENTINEL_T32_04', 2],
  ['SENTINEL_T32_05', 1],
]);
const SELECTION_SENTINEL_ANSWERS = new Map([
  ['SENTINEL_T4_01', new Set(['SENTINEL_T4_01_candidate_1', 'SENTINEL_T4_01_candidate_4'])],
  ['SENTINEL_T4_02', new Set(['SENTINEL_T4_02_candidate_1'])],
  ['SENTINEL_T4_03', new Set(['SENTINEL_T4_03_candidate_1', 'SENTINEL_T4_03_candidate_6'])],
  ['SENTINEL_T4_04', new Set(['SENTINEL_T4_04_candidate_1'])],
  ['SENTINEL_T4_05', new Set(['SENTINEL_T4_05_candidate_1', 'SENTINEL_T4_05_candidate_6'])],
]);
const SENTINEL_ANSWERS = new Map([
  ['pairJudgment', PAIR_SENTINEL_ANSWERS],
  ['forcedChoice', FORCED_SENTINEL_ANSWERS],
  ['sceneMatching', SCENE_SENTINEL_ANSWERS],
  ['contextMatching2', CONTEXT2_SENTINEL_ANSWERS],
  ['selection', SELECTION_SENTINEL_ANSWERS],
]);

export default {
  async fetch(request, env, ctx) {
    const origin = allowedOrigin(request, env);
    if (request.method === 'OPTIONS') {
      return origin ? withCors(new Response(null, { status: 204 }), origin) : jsonError('Origin not allowed.', 403);
    }
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      try {
        const databaseProbe = await env.DB.prepare('SELECT 1 AS ok').first();
        if (Number(databaseProbe?.ok) !== 1) throw new Error('Unexpected D1 health-check result.');
        return withCors(json({
          ok: true,
          service: 'perception-study-api',
          database: 'connected',
          sentinelScreeningVersion: SENTINEL_SCREENING_VERSION,
          studyTypes: [...STUDY_TYPES],
        }), origin);
      } catch (error) {
        console.error('D1 health check failed', error);
        return withCors(json({
          ok: false,
          service: 'perception-study-api',
          database: 'unavailable',
          sentinelScreeningVersion: SENTINEL_SCREENING_VERSION,
          studyTypes: [...STUDY_TYPES],
          error: 'The study database is temporarily unavailable.',
        }, 503), origin);
      }
    }
    if (!origin) return jsonError('Origin not allowed.', 403);
    try {
      if (request.method === 'POST' && url.pathname === '/api/v1/login') return withCors(await login(request, env, ctx), origin);
      if (request.method === 'POST' && url.pathname === '/api/v1/anonymous-login') return withCors(await anonymousLogin(request, env), origin);
      if (request.method === 'POST' && url.pathname === '/api/v1/demographics') return withCors(await saveDemographics(request, env), origin);
      if (request.method === 'POST' && url.pathname === '/api/v1/submit') return withCors(await resultWriteWithFallback(request, env, submit, 'completed'), origin);
      if (request.method === 'POST' && url.pathname === '/api/v1/screen-out') return withCors(await resultWriteWithFallback(request, env, screenOut, 'screened_out'), origin);
      return withCors(jsonError('Not found.', 404), origin);
    } catch (error) {
      console.error('Unhandled request error', error);
      return withCors(jsonError('The study service could not process the request.', 500), origin);
    }
  },
};

async function login(request, env, ctx) {
  const body = parseJson(await readBody(request, 32_000));
  const rawUsername = cleanString(body.username, 80);
  const presentedUsername = normalizeCredentialToken(rawUsername);
  const username = normalizeCredentialUsername(rawUsername);
  const isInternalUser = INTERNAL_USERNAMES.has(username);
  const isInhouse = username === 'gilab-inhouse';
  const rawPassword = typeof body.password === 'string' ? body.password : '';
  // The single-field login intentionally sends the username as its password.
  // Apply the same typography normalization to both copies so pasted Unicode
  // dashes or zero-width characters do not turn an internal login into a
  // malformed Prolific request.
  const password = rawPassword.trim() === rawUsername ? presentedUsername : rawPassword;
  const studyType = cleanString(body.studyType, 40);
  const sessionId = cleanString(body.clientSessionId, 100);
  const requestedRunId = identifier(body.inhouseRunId);
  const studyRunId = isInhouse ? requestedRunId || sessionId : null;
  const startedAt = isoString(body.startedAt);
  const prolific = body.prolific && typeof body.prolific === 'object' ? body.prolific : {};
  const suppliedProlific = {
    pid: identifier(prolific.prolificPid),
    studyId: identifier(prolific.studyId),
    sessionId: identifier(prolific.sessionId),
  };
  const suppliedProlificCount = Object.values(suppliedProlific).filter(Boolean).length;
  const accessSource = isInternalUser ? 'internal' : suppliedProlificCount === 3 ? 'prolific' : 'direct';
  const prolificRequired = String(env.REQUIRE_PROLIFIC_IDENTIFIERS ?? '').toLowerCase() === 'true';
  if (!username || password.length < 8 || password.length > 256 || !STUDY_TYPES.has(studyType) || !sessionId || !startedAt || (!isInternalUser && suppliedProlificCount > 0 && suppliedProlificCount < 3) || (!isInternalUser && prolificRequired && suppliedProlificCount !== 3)) {
    return jsonError('Missing or invalid login information.', 400);
  }

  const fingerprint = await sha256Hex(`${request.headers.get('CF-Connecting-IP') ?? 'unknown'}:${env.SESSION_SIGNING_SECRET}`);
  const recentFailures = await env.DB.prepare(
    `SELECT count(*) AS count FROM login_attempts
     WHERE successful = 0 AND attempted_at >= datetime('now', '-15 minutes')
       AND (client_fingerprint_hash = ?1 OR username_normalized = ?2)`,
  ).bind(fingerprint, username).first();
  if (Number(recentFailures?.count ?? 0) >= 10) return jsonError('Too many login attempts. Please wait 15 minutes and try again.', 429);

  const credential = await env.DB.prepare(
    `SELECT id, password_hash, password_salt, password_iterations,
            assigned_study_type, assignment_seed, active
     FROM access_credentials WHERE username = ?1 COLLATE NOCASE`,
  ).bind(username).first();
  let validCredential = false;
  try {
    // Keep the dummy path within Workers WebCrypto's PBKDF2 limit and at the
    // same cost as generated credentials. The former 210,000 fallback caused
    // unknown usernames to fail before the login attempt could be recorded.
    const derived = await pbkdf2(password, credential?.password_salt ?? DUMMY_SALT, Number(credential?.password_iterations ?? 100000));
    validCredential = Boolean(credential && credential.active === 1 && timingSafeEqual(derived, fromBase64(credential.password_hash)));
  } catch (error) {
    // Authentication failures must still be rate-limited. In particular, a
    // malformed/missing credential must never escape as an unlogged 500.
    console.error('Credential verification failed', error);
  }
  await env.DB.prepare(
    `INSERT INTO login_attempts (username_normalized, successful, client_fingerprint_hash, country, user_agent)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  ).bind(username, validCredential ? 1 : 0, fingerprint, request.cf?.country ?? null, request.headers.get('User-Agent')).run();
  ctx.waitUntil(env.DB.prepare("DELETE FROM login_attempts WHERE attempted_at < datetime('now', '-30 days')").run());
  if (!validCredential) return jsonError('Invalid username or password.', 401);
  if (!isInternalUser && credential.assigned_study_type !== studyType) return jsonError('These credentials are assigned to a different test.', 403);

  const directMapping = {
    pid: `direct-credential-${credential.id}`,
    studyId: 'direct-access',
    sessionId: `direct-credential-${credential.id}`,
  };
  const effectiveProlific = isInternalUser
    ? { pid: `internal-${username}`, studyId: 'internal-gilab', sessionId: `internal-${username}` }
    : accessSource === 'prolific' ? suppliedProlific : directMapping;
  return establishSession({
    request,
    env,
    credential,
    studyType,
    sessionId,
    studyRunId,
    startedAt,
    effectiveProlific,
    accessSource,
    isInternalUser,
    isInhouse,
    clientMetadata: body.clientMetadata,
    anonymousEntry: false,
  });
}

async function anonymousLogin(request, env) {
  const body = parseJson(await readBody(request, 32_000));
  const studyType = cleanString(body.studyType, 40);
  const sessionId = cleanString(body.clientSessionId, 100);
  const startedAt = isoString(body.startedAt);
  const prolific = body.prolific && typeof body.prolific === 'object' ? body.prolific : {};
  const effectiveProlific = {
    pid: identifier(prolific.prolificPid),
    studyId: identifier(prolific.studyId),
    sessionId: identifier(prolific.sessionId),
  };
  if (!STUDY_TYPES.has(studyType) || !sessionId || !startedAt || Object.values(effectiveProlific).some((value) => !value)) {
    return jsonError('Missing or invalid anonymous study information.', 400);
  }

  const identifierOwner = await anonymousCredentialForIdentifiers(env, effectiveProlific);
  if (identifierOwner && (identifierOwner.provisioning_mode !== 'anonymous' || identifierOwner.assigned_study_type !== studyType)) {
    return jsonError('These Prolific identifiers are already assigned to another study access.', 409);
  }

  if (!identifierOwner) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO participant_mappings
         (credential_id, prolific_pid, prolific_study_id, prolific_session_id)
       SELECT credential.id, ?1, ?2, ?3
       FROM access_credentials AS credential
       WHERE credential.provisioning_mode = 'anonymous'
         AND credential.assigned_study_type = ?4
         AND credential.active = 1
         AND NOT EXISTS (
           SELECT 1 FROM participant_mappings AS mapping
           WHERE mapping.credential_id = credential.id
         )
       ORDER BY credential.anonymous_order ASC
       LIMIT 1`,
    ).bind(effectiveProlific.pid, effectiveProlific.studyId, effectiveProlific.sessionId, studyType).run();
  }

  const credential = await anonymousCredentialForIdentifiers(env, effectiveProlific);
  if (!credential) {
    const conflictingOwner = await env.DB.prepare(
      `SELECT id FROM participant_mappings
       WHERE prolific_session_id = ?1 OR (prolific_pid = ?2 AND prolific_study_id = ?3)`,
    ).bind(effectiveProlific.sessionId, effectiveProlific.pid, effectiveProlific.studyId).first();
    return conflictingOwner
      ? jsonError('These Prolific identifiers are already linked to another study access.', 409)
      : jsonError('No anonymous participant slots remain for this test. Please contact the study organiser.', 503);
  }
  if (credential.provisioning_mode !== 'anonymous' || credential.assigned_study_type !== studyType) {
    return jsonError('These Prolific identifiers are already assigned to another study access.', 409);
  }

  return establishSession({
    request,
    env,
    credential,
    studyType,
    sessionId,
    studyRunId: null,
    startedAt,
    effectiveProlific,
    accessSource: 'prolific',
    isInternalUser: false,
    isInhouse: false,
    clientMetadata: body.clientMetadata,
    anonymousEntry: true,
  });
}

async function anonymousCredentialForIdentifiers(env, prolific) {
  return env.DB.prepare(
    `SELECT credential.id, credential.username, credential.assigned_study_type,
            credential.assignment_seed, credential.active,
            credential.provisioning_mode, credential.anonymous_order
     FROM participant_mappings AS mapping
     JOIN access_credentials AS credential ON credential.id = mapping.credential_id
     WHERE mapping.prolific_session_id = ?1
        OR (mapping.prolific_pid = ?2 AND mapping.prolific_study_id = ?3)
     ORDER BY CASE
       WHEN mapping.prolific_session_id = ?1
        AND mapping.prolific_pid = ?2
        AND mapping.prolific_study_id = ?3 THEN 0 ELSE 1 END
     LIMIT 1`,
  ).bind(prolific.sessionId, prolific.pid, prolific.studyId).first();
}

async function establishSession({ request, env, credential, studyType, sessionId, studyRunId, startedAt, effectiveProlific, accessSource, isInternalUser, isInhouse, clientMetadata, anonymousEntry }) {
  let mapping = await env.DB.prepare(
    `SELECT id, credential_id, prolific_pid, prolific_study_id, prolific_session_id
     FROM participant_mappings WHERE credential_id = ?1`,
  ).bind(credential.id).first();

  if (accessSource === 'prolific') {
    const identifierOwner = await env.DB.prepare(
      `SELECT id, credential_id FROM participant_mappings
       WHERE prolific_session_id = ?1 OR (prolific_pid = ?2 AND prolific_study_id = ?3)`,
    ).bind(effectiveProlific.sessionId, effectiveProlific.pid, effectiveProlific.studyId).first();
    if (identifierOwner && identifierOwner.credential_id !== credential.id) {
      return jsonError('These credentials or Prolific identifiers are already linked to another session.', 409);
    }
    if (mapping && isDirectParticipantMapping(mapping, credential.id)) {
      try {
        await env.DB.prepare(
          `UPDATE participant_mappings SET
             prolific_pid = ?2, prolific_study_id = ?3, prolific_session_id = ?4,
             last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?1`,
        ).bind(mapping.id, effectiveProlific.pid, effectiveProlific.studyId, effectiveProlific.sessionId).run();
        mapping = { ...mapping, prolific_pid: effectiveProlific.pid, prolific_study_id: effectiveProlific.studyId, prolific_session_id: effectiveProlific.sessionId };
      } catch {
        return jsonError('These credentials or Prolific identifiers are already linked to another session.', 409);
      }
    } else if (mapping && (mapping.prolific_pid !== effectiveProlific.pid || mapping.prolific_study_id !== effectiveProlific.studyId || mapping.prolific_session_id !== effectiveProlific.sessionId)) {
      return jsonError('These credentials or Prolific identifiers are already linked to another session.', 409);
    }
  }

  if (!mapping) {
    try {
      await env.DB.prepare(
        `INSERT INTO participant_mappings (credential_id, prolific_pid, prolific_study_id, prolific_session_id)
         VALUES (?1, ?2, ?3, ?4)`,
      ).bind(credential.id, effectiveProlific.pid, effectiveProlific.studyId, effectiveProlific.sessionId).run();
    } catch {
      return jsonError('These credentials or Prolific identifiers are already linked to another session.', 409);
    }
  } else {
    await env.DB.prepare("UPDATE participant_mappings SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1").bind(mapping.id).run();
  }

  mapping = await env.DB.prepare('SELECT id FROM participant_mappings WHERE credential_id = ?1').bind(credential.id).first();
  const reusableSession = isInternalUser ? null : await env.DB.prepare(
    `SELECT id FROM study_sessions
     WHERE credential_id = ?1 AND study_type = ?2
     ORDER BY screened_out DESC, (status = 'completed') DESC, authenticated_at ASC
     LIMIT 1`,
  ).bind(credential.id, studyType).first();
  const effectiveSessionId = reusableSession?.id ?? sessionId;
  const previousSession = await env.DB.prepare('SELECT assignment_batch, inhouse FROM study_sessions WHERE id = ?1').bind(effectiveSessionId).first();
  const credentialBatch = batchFromSeed(credential.assignment_seed);
  const assignmentBatch = previousSession?.assignment_batch ?? (isInhouse ? await batchForRun(studyRunId, env.SESSION_SIGNING_SECRET) : credentialBatch);
  if (!assignmentBatch) return jsonError('These credentials do not have a valid participant batch.', 500);
  await env.DB.prepare(
    `INSERT INTO study_sessions (
       id, credential_id, participant_mapping_id, study_type, started_at,
       client_metadata_json, cloudflare_metadata_json, assignment_batch, inhouse, study_run_id, access_source, anonymous_entry
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
     ON CONFLICT(id) DO UPDATE SET
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       client_metadata_json = excluded.client_metadata_json,
       cloudflare_metadata_json = excluded.cloudflare_metadata_json,
       access_source = excluded.access_source
     WHERE study_sessions.credential_id = excluded.credential_id
       AND study_sessions.participant_mapping_id = excluded.participant_mapping_id
       AND study_sessions.study_type = excluded.study_type`,
  ).bind(effectiveSessionId, credential.id, mapping.id, studyType, startedAt, JSON.stringify(safeObject(clientMetadata)), JSON.stringify(cloudflareMetadata(request)), assignmentBatch, isInhouse ? 1 : 0, studyRunId, accessSource, anonymousEntry ? 1 : 0).run();
  const session = await env.DB.prepare('SELECT id, credential_id, study_type, status, receipt_id, assignment_batch, inhouse, study_run_id, screened_out, screen_out_receipt_id, sentinel_failures FROM study_sessions WHERE id = ?1').bind(effectiveSessionId).first();
  if (!session || session.credential_id !== credential.id || session.study_type !== studyType || (isInhouse && session.study_run_id !== studyRunId)) return jsonError('This browser session cannot be resumed with these credentials.', 409);

  const token = await signToken({
    sid: effectiveSessionId,
    cid: credential.id,
    st: studyType,
    inh: session.inhouse === 1,
    batch: session.assignment_batch,
    run: session.study_run_id ?? null,
    exp: Math.floor(Date.now() / 1000) + tokenTtl(env),
  }, env.SESSION_SIGNING_SECRET);
  const effectiveSeed = isInhouse ? `batch:${session.assignment_batch}:${studyType}:gilab-inhouse` : credential.assignment_seed;
  return json({ ok: true, token, sessionId: effectiveSessionId, studyType, assignmentSeed: effectiveSeed, assignmentBatch: session.assignment_batch, inhouse: session.inhouse === 1, studyRunId: session.study_run_id, accessSource, anonymousEntry, alreadyCompleted: session.status === 'completed', receiptId: session.receipt_id ?? null, screenedOut: session.screened_out === 1, screenOutReceiptId: session.screen_out_receipt_id ?? null, sentinelFailures: Number(session.sentinel_failures ?? 0), sentinelScreeningVersion: SENTINEL_SCREENING_VERSION });
}

function isDirectParticipantMapping(mapping, credentialId) {
  const placeholder = `direct-credential-${credentialId}`;
  return mapping.prolific_pid === placeholder
    && mapping.prolific_study_id === 'direct-access'
    && mapping.prolific_session_id === placeholder;
}

async function saveDemographics(request, env) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const claims = await verifyToken(token, env.SESSION_SIGNING_SECRET);
  if (!claims) return jsonError('Your study session has expired. Please sign in again.', 401);
  const body = parseJson(await readBody(request, 64_000));
  const sessionId = cleanString(body.sessionId, 100);
  const studyType = cleanString(body.studyType, 40);
  const schemaVersion = cleanString(body.schemaVersion, 40) || '2026-10-20.5';
  if (sessionId !== claims.sid || !STUDY_TYPES.has(studyType)) return jsonError('The demographic payload is invalid.', 400);

  const session = await env.DB.prepare(
    `SELECT id, credential_id, study_type, status, inhouse, screened_out,
            demographics_saved_at
     FROM study_sessions WHERE id = ?1`,
  ).bind(sessionId).first();
  if (!session || session.credential_id !== claims.cid || session.study_type !== studyType) return jsonError('Study session not found.', 404);
  if (session.screened_out === 1) return jsonError('This session was screened out and cannot be changed.', 409);
  if (session.status === 'completed') return json({ ok: true, savedAt: session.demographics_saved_at, alreadyStored: true });

  const skipped = body.demographicsSkipped === true;
  const consented = body.consented === true;
  const consentedAt = isoString(body.consentedAt);
  if (!consented || !consentedAt) return jsonError('Consent must be recorded before demographic information.', 400);
  const normalized = normalizeDemographics(body.demographics, session.inhouse === 1);
  if (!skipped && !validDemographics(normalized, session.inhouse === 1)) return jsonError('The demographic information is incomplete or invalid.', 400);
  const savedAt = new Date().toISOString();
  const normalizedJson = JSON.stringify(normalized);
  await env.DB.prepare(
    `UPDATE study_sessions SET
       status = CASE WHEN status = 'authenticated' THEN 'in_progress' ELSE status END,
       schema_version = ?2, demographics_skipped = ?3, demographics_json = ?4,
       demographics_saved_at = ?5, client_metadata_json = ?6,
       consented = 1, consented_at = COALESCE(consented_at, ?7),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?1 AND status <> 'completed' AND screened_out = 0`,
  ).bind(sessionId, schemaVersion, skipped ? 1 : 0, normalizedJson, savedAt, JSON.stringify(safeObject(body.clientMetadata)), consentedAt).run();
  const stored = await env.DB.prepare(
    'SELECT demographics_skipped, demographics_json, demographics_saved_at FROM study_sessions WHERE id = ?1',
  ).bind(sessionId).first();
  if (!stored || stored.demographics_saved_at !== savedAt || stored.demographics_json !== normalizedJson || Number(stored.demographics_skipped) !== Number(skipped)) {
    return jsonError('The database did not confirm the demographic information. Please retry.', 503);
  }
  return json({ ok: true, savedAt, alreadyStored: false });
}

async function submit(request, env) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const claims = await verifyToken(token, env.SESSION_SIGNING_SECRET);
  if (!claims) return jsonError('Your study session has expired. Please sign in again.', 401);
  const raw = await readBody(request, 1_500_000);
  const payloadHash = await sha256Hex(raw);
  const body = parseJson(raw);
  const sessionId = cleanString(body.sessionId, 100);
  const studyType = cleanString(body.studyType, 40);
  const completedAt = isoString(body.completedAt);
  const schemaVersion = cleanString(body.schemaVersion, 40) || '2026-10-20.5';
  const trials = Array.isArray(body.trials) ? body.trials : [];
  if (sessionId !== claims.sid || !STUDY_TYPES.has(studyType) || !completedAt || !trials.length || trials.length > 150) return jsonError('The completed study payload is invalid.', 400);

  const session = await env.DB.prepare(
    'SELECT id, credential_id, study_type, status, payload_sha256, receipt_id, assignment_batch, inhouse, screened_out FROM study_sessions WHERE id = ?1',
  ).bind(sessionId).first();
  if (!session || session.credential_id !== claims.cid || session.study_type !== studyType) return jsonError('Study session not found.', 404);
  if (session.screened_out === 1) return jsonError('This session was screened out and cannot be completed.', 409);
  if (session.status === 'completed') {
    if (session.payload_sha256 === payloadHash) return json({ ok: true, receiptId: session.receipt_id, alreadyStored: true, fallbackStored: false, storage: 'd1' });
    return jsonError('This session was already completed with different data.', 409);
  }

  const normalized = normalizeTrials(trials);
  const screening = evaluateSentinels(studyType, normalized);
  if (screening.sentinels !== SENTINEL_COUNT) return jsonError('The completed study does not contain the complete sentinel set.', 400);
  if (session.inhouse !== 1 && screening.failures >= sentinelScreenOutThreshold(studyType)) {
    return persistScreenOut(env, session, body, normalized, screening, completedAt, schemaVersion, payloadHash);
  }
  const receiptId = `ps-${payloadHash.slice(0, 20)}`;
  const statements = normalized.map((trial) => env.DB.prepare(
    `INSERT INTO trial_responses (session_id, trial_number, trial_id, response_time_ms, is_sentinel, sentinel_id, response_json)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(session_id, trial_number) DO UPDATE SET
       trial_id = excluded.trial_id, response_time_ms = excluded.response_time_ms,
       is_sentinel = excluded.is_sentinel, sentinel_id = excluded.sentinel_id,
       response_json = excluded.response_json,
       received_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ).bind(sessionId, trial.trialNumber, trial.trialId, trial.responseTimeMs, trial.isSentinel, trial.sentinelId, JSON.stringify(trial.response)));
  statements.push(env.DB.prepare(
    `UPDATE study_sessions SET
       status = 'completed', schema_version = ?2, completed_at = ?3,
       received_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       demographics_skipped = ?4, demographics_json = ?5, training_json = ?6,
       client_metadata_json = ?7, response_count = ?8,
       payload_sha256 = ?9, receipt_id = ?10, final_outcome = 'completed',
       sentinel_failures = ?11, sentinels_evaluated = ?12,
       sentinel_checks_evaluated = ?13
     WHERE id = ?1 AND status <> 'completed' AND screened_out = 0`,
  ).bind(sessionId, schemaVersion, completedAt, body.demographicsSkipped === true ? 1 : 0, JSON.stringify(normalizeDemographics(body.demographics, session.inhouse === 1)), JSON.stringify(Array.isArray(body.trainingAttempts) ? body.trainingAttempts : []), JSON.stringify(safeObject(body.clientMetadata)), normalized.length, payloadHash, receiptId, screening.failures, screening.sentinels, screening.checks));
  await env.DB.batch(statements);
  const stored = await env.DB.prepare('SELECT status, response_count, receipt_id FROM study_sessions WHERE id = ?1').bind(sessionId).first();
  if (stored?.status !== 'completed' || Number(stored.response_count) !== normalized.length || stored.receipt_id !== receiptId) return jsonError('The database did not confirm the complete response set. Please retry.', 503);
  return json({ ok: true, receiptId, alreadyStored: false, fallbackStored: false, storage: 'd1' });
}

async function screenOut(request, env) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const claims = await verifyToken(token, env.SESSION_SIGNING_SECRET);
  if (!claims) return jsonError('Your study session has expired. Please sign in again.', 401);
  const raw = await readBody(request, 1_500_000);
  const payloadHash = await sha256Hex(raw);
  const body = parseJson(raw);
  const sessionId = cleanString(body.sessionId, 100);
  const studyType = cleanString(body.studyType, 40);
  const screenedOutAt = isoString(body.screenedOutAt);
  const schemaVersion = cleanString(body.schemaVersion, 40) || '2026-10-20.5';
  const trials = Array.isArray(body.trials) ? body.trials : [];
  if (sessionId !== claims.sid || !STUDY_TYPES.has(studyType) || !screenedOutAt || !trials.length || trials.length > 150) return jsonError('The screen-out payload is invalid.', 400);

  const session = await env.DB.prepare(
    `SELECT id, credential_id, study_type, status, assignment_batch, inhouse,
            screened_out, screen_out_receipt_id, sentinel_failures,
            sentinels_evaluated, sentinel_checks_evaluated
     FROM study_sessions WHERE id = ?1`,
  ).bind(sessionId).first();
  if (!session || session.credential_id !== claims.cid || session.study_type !== studyType) return jsonError('Study session not found.', 404);
  if (session.status === 'completed') return jsonError('This session has already been completed.', 409);
  if (session.screened_out === 1) {
    return json({ ok: true, receiptId: session.screen_out_receipt_id, sentinelFailures: Number(session.sentinel_failures), sentinelsEvaluated: Number(session.sentinels_evaluated), sentinelChecksEvaluated: Number(session.sentinel_checks_evaluated), alreadyStored: true, screenedOut: true, fallbackStored: false, storage: 'd1' });
  }

  const normalized = normalizeTrials(trials);
  const screening = evaluateSentinels(studyType, normalized);
  if (screening.failures < sentinelScreenOutThreshold(studyType)) return jsonError('The sentinel screen-out threshold has not been reached.', 422);

  return persistScreenOut(env, session, body, normalized, screening, screenedOutAt, schemaVersion, payloadHash);
}

async function resultWriteWithFallback(request, env, handler, requestedOutcome) {
  const fallbackRequest = request.clone();
  try {
    const response = await handler(request, env);
    if (response.status < 500) return response;
    console.error(`D1 result write returned ${response.status}; attempting private R2 fallback.`);
    return await persistResultFallback(fallbackRequest, env, requestedOutcome, `http_${response.status}`);
  } catch (error) {
    console.error('D1 result write failed; attempting private R2 fallback.', error);
    return persistResultFallback(fallbackRequest, env, requestedOutcome, error instanceof Error ? error.name : 'unknown_error');
  }
}

export async function persistResultFallback(request, env, requestedOutcome, failureClass = 'd1_error') {
  if (!env.RESULTS_FALLBACK) throw new Error('The private result fallback bucket is not configured.');
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const claims = await verifyToken(token, env.SESSION_SIGNING_SECRET);
  if (!claims) return jsonError('Your study session has expired. Please sign in again.', 401);

  const raw = await readBody(request, 1_500_000);
  const payloadHash = await sha256Hex(raw);
  const body = parseJson(raw);
  const sessionId = cleanString(body.sessionId, 100);
  const studyType = cleanString(body.studyType, 40);
  const startedAt = isoString(body.startedAt);
  const consentedAt = isoString(body.consentedAt);
  const outcomeAt = requestedOutcome === 'completed' ? isoString(body.completedAt) : isoString(body.screenedOutAt);
  const trials = Array.isArray(body.trials) ? body.trials : [];
  if (sessionId !== claims.sid || claims.st !== studyType || !STUDY_TYPES.has(studyType)
      || !startedAt || body.consented !== true || !consentedAt || !outcomeAt
      || !trials.length || trials.length > 150) {
    return jsonError('The fallback result payload is invalid. Please sign in again and retry.', 400);
  }

  const normalized = normalizeTrials(trials);
  const screening = evaluateSentinels(studyType, normalized);
  const inhouse = claims.inh === true;
  const demographicsSkipped = body.demographicsSkipped === true;
  const demographics = normalizeDemographics(body.demographics, inhouse);
  if (!demographicsSkipped && !validDemographics(demographics, inhouse)) {
    return jsonError('The fallback demographic payload is incomplete or invalid.', 400);
  }
  let outcome = requestedOutcome;
  if (requestedOutcome === 'completed') {
    if (screening.sentinels !== SENTINEL_COUNT) return jsonError('The completed study does not contain the complete sentinel set.', 400);
    if (!inhouse && screening.failures >= sentinelScreenOutThreshold(studyType)) outcome = 'screened_out';
  } else if (inhouse || screening.failures < sentinelScreenOutThreshold(studyType)) {
    return jsonError('The screen-out fallback payload is invalid.', 422);
  }

  const sessionHash = await sha256Hex(sessionId);
  const objectKey = `fallback-results/${studyType}/${sessionHash.slice(0, 32)}-${outcome}.csv`;
  const receiptId = `r2-${payloadHash.slice(0, 20)}`;
  const existing = await env.RESULTS_FALLBACK.head(objectKey);
  if (existing) {
    if (existing.customMetadata?.payloadSha256 !== payloadHash) {
      return jsonError('A private backup already exists for this session with different data. Please contact the study organiser.', 409);
    }
    return json({
      ok: true,
      receiptId,
      alreadyStored: true,
      fallbackStored: true,
      storage: 'r2',
      screenedOut: outcome === 'screened_out',
      sentinelFailures: screening.failures,
      sentinelsEvaluated: screening.sentinels,
      sentinelChecksEvaluated: screening.checks,
    });
  }

  const storedAt = new Date().toISOString();
  const csv = fallbackResultCsv({
    body,
    claims,
    normalized,
    screening,
    outcome,
    outcomeAt,
    storedAt,
    receiptId,
    payloadHash,
    failureClass,
  });
  await env.RESULTS_FALLBACK.put(objectKey, csv, {
    httpMetadata: {
      contentType: 'text/csv; charset=utf-8',
      contentDisposition: `attachment; filename="${receiptId}.csv"`,
    },
    customMetadata: {
      payloadSha256: payloadHash,
      receiptId,
      sessionHash: sessionHash.slice(0, 32),
      credentialId: String(claims.cid),
      studyType,
      outcome,
      storedAt,
      trialCount: String(normalized.length),
    },
  });
  const confirmed = await env.RESULTS_FALLBACK.head(objectKey);
  if (!confirmed || confirmed.customMetadata?.payloadSha256 !== payloadHash || Number(confirmed.customMetadata?.trialCount) !== normalized.length) {
    throw new Error('R2 did not confirm the private fallback object.');
  }
  return json({
    ok: true,
    receiptId,
    alreadyStored: false,
    fallbackStored: true,
    storage: 'r2',
    screenedOut: outcome === 'screened_out',
    sentinelFailures: screening.failures,
    sentinelsEvaluated: screening.sentinels,
    sentinelChecksEvaluated: screening.checks,
  });
}

export function fallbackResultCsv({ body, claims, normalized, screening, outcome, outcomeAt, storedAt, receiptId, payloadHash, failureClass }) {
  const columns = [
    'fallback_schema_version', 'receipt_id', 'storage', 'failure_class', 'outcome', 'stored_at',
    'study_schema_version', 'session_id', 'credential_id', 'study_type', 'started_at', 'outcome_at',
    'assignment_batch', 'inhouse', 'study_run_id', 'consented', 'consented_at',
    'demographics_skipped', 'demographics_json', 'training_attempts_json', 'client_metadata_json',
    'sentinel_failures', 'sentinels_evaluated', 'sentinel_checks_evaluated', 'payload_sha256',
    'trial_number', 'trial_id', 'response_time_ms', 'is_sentinel', 'sentinel_id', 'response_json',
  ];
  const common = [
    '1', receiptId, 'r2_private_fallback', cleanString(failureClass, 80), outcome, storedAt,
    cleanString(body.schemaVersion, 40), claims.sid, String(claims.cid), claims.st,
    isoString(body.startedAt) ?? '', outcomeAt, claims.batch ?? '', claims.inh === true ? '1' : '0', claims.run ?? '',
    body.consented === true ? '1' : '0', isoString(body.consentedAt) ?? '', body.demographicsSkipped === true ? '1' : '0',
    JSON.stringify(normalizeDemographics(body.demographics, claims.inh === true)),
    JSON.stringify(Array.isArray(body.trainingAttempts) ? body.trainingAttempts : []),
    JSON.stringify(safeObject(body.clientMetadata)), String(screening.failures), String(screening.sentinels),
    String(screening.checks), payloadHash,
  ];
  const lines = [columns.map(csvCell).join(',')];
  for (const trial of normalized) {
    lines.push([...common, String(trial.trialNumber), trial.trialId, String(trial.responseTimeMs), String(trial.isSentinel), trial.sentinelId ?? '', JSON.stringify(trial.response)].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

async function persistScreenOut(env, session, body, normalized, screening, screenedOutAt, schemaVersion, payloadHash) {
  const sessionId = session.id;
  const receiptId = `screen-${payloadHash.slice(0, 20)}`;
  const statements = trialStatements(env, sessionId, normalized);
  statements.push(env.DB.prepare(
    `UPDATE study_sessions SET
       status = 'screened_out', schema_version = ?2, final_outcome = 'screened_out',
       screened_out = 1, screened_out_at = ?3,
       sentinel_failures = ?4, sentinels_evaluated = ?5,
       sentinel_checks_evaluated = ?6,
       screen_out_reason = 'sentinel_failures', screen_out_receipt_id = ?7,
       received_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       demographics_skipped = ?8, demographics_json = ?9, training_json = ?10,
       client_metadata_json = ?11, response_count = ?12
     WHERE id = ?1 AND status <> 'completed' AND screened_out = 0`,
  ).bind(sessionId, schemaVersion, screenedOutAt, screening.failures, screening.sentinels, screening.checks, receiptId, body.demographicsSkipped === true ? 1 : 0, JSON.stringify(normalizeDemographics(body.demographics, session.inhouse === 1)), JSON.stringify(Array.isArray(body.trainingAttempts) ? body.trainingAttempts : []), JSON.stringify(safeObject(body.clientMetadata)), normalized.length));
  await env.DB.batch(statements);
  const stored = await env.DB.prepare(
    'SELECT status, screened_out, sentinel_failures, sentinels_evaluated, sentinel_checks_evaluated, response_count, screen_out_receipt_id FROM study_sessions WHERE id = ?1',
  ).bind(sessionId).first();
  if (stored?.status !== 'screened_out' || stored.screened_out !== 1 || Number(stored.sentinel_failures) !== screening.failures || Number(stored.response_count) !== normalized.length || stored.screen_out_receipt_id !== receiptId) {
    return jsonError('The database did not confirm the screen-out record. Please retry.', 503);
  }
  return json({ ok: true, receiptId, sentinelFailures: screening.failures, sentinelsEvaluated: screening.sentinels, sentinelChecksEvaluated: screening.checks, alreadyStored: false, screenedOut: true, fallbackStored: false, storage: 'd1' });
}

function normalizeTrials(trials) {
  const seenNumbers = new Set();
  return trials.map((trial, index) => {
    const trialNumber = Number(trial.trialNumber);
    const responseTimeMs = Number(trial.responseTimeMs);
    const trialId = cleanString(trial.trialId, 240);
    if (!Number.isInteger(trialNumber) || trialNumber < 1 || trialNumber > 150 || seenNumbers.has(trialNumber) || !trialId || !Number.isInteger(responseTimeMs) || responseTimeMs < 0) throw new Error(`Invalid trial at index ${index}.`);
    seenNumbers.add(trialNumber);
    const suppliedSentinelId = cleanString(trial.sentinelId, 240);
    const inferredSentinelId = /^SENTINEL_T(?:[1-4]|32)_0[1-5]$/.test(trialId) ? trialId : '';
    const sentinelId = suppliedSentinelId || inferredSentinelId || null;
    return { trialNumber, trialId, responseTimeMs, isSentinel: sentinelId ? 1 : 0, sentinelId, response: safeObject(trial.response) };
  });
}

function trialStatements(env, sessionId, trials) {
  return trials.map((trial) => env.DB.prepare(
    `INSERT INTO trial_responses (session_id, trial_number, trial_id, response_time_ms, is_sentinel, sentinel_id, response_json)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(session_id, trial_number) DO UPDATE SET
       trial_id = excluded.trial_id, response_time_ms = excluded.response_time_ms,
       is_sentinel = excluded.is_sentinel, sentinel_id = excluded.sentinel_id,
       response_json = excluded.response_json,
       received_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ).bind(sessionId, trial.trialNumber, trial.trialId, trial.responseTimeMs, trial.isSentinel, trial.sentinelId, JSON.stringify(trial.response)));
}

export function evaluateSentinels(studyType, trials) {
  const answerKey = SENTINEL_ANSWERS.get(studyType);
  if (!answerKey) return { sentinels: 0, checks: 0, failures: 0 };
  const sentinels = new Map();
  for (const trial of trials) {
    if (trial.sentinelId && answerKey.has(trial.sentinelId)) sentinels.set(trial.sentinelId, trial);
  }
  const scores = [...sentinels.values()].map((trial) => sentinelScore(studyType, trial));
  return {
    sentinels: sentinels.size,
    checks: scores.reduce((total, score) => total + score.checks, 0),
    failures: scores.reduce((total, score) => total + score.failures, 0),
  };
}

function sentinelScore(studyType, trial) {
  const response = trial.response;
  if (studyType === 'pairJudgment') {
    const expected = PAIR_SENTINEL_ANSWERS.get(trial.sentinelId);
    const checks = Object.entries(expected).map(([field, value]) => Number(response[field]) !== value);
    return { checks: checks.length, failures: Number(checks.some(Boolean)) };
  }
  if (studyType === 'forcedChoice') {
    return { checks: 1, failures: Number(response.selectedOption !== FORCED_SENTINEL_ANSWERS.get(trial.sentinelId)) };
  }
  if (studyType === 'sceneMatching') {
    return { checks: 1, failures: Number(Number(response.selectedOption) !== SCENE_SENTINEL_ANSWERS.get(trial.sentinelId)) };
  }
  if (studyType === 'contextMatching2') {
    return { checks: 1, failures: Number(Number(response.selectedOption) !== CONTEXT2_SENTINEL_ANSWERS.get(trial.sentinelId)) };
  }
  const selected = new Set(Array.isArray(response.selectedCandidateIds) ? response.selectedCandidateIds.map(String) : []);
  const expected = SELECTION_SENTINEL_ANSWERS.get(trial.sentinelId) ?? new Set();
  const candidateIds = Array.from({ length: 6 }, (_, index) => `${trial.sentinelId}_candidate_${index + 1}`);
  const failed = candidateIds.some((id) => selected.has(id) !== expected.has(id));
  return { checks: candidateIds.length, failures: Number(failed) };
}

function cloudflareMetadata(request) {
  return {
    country: request.cf?.country ?? null,
    continent: request.cf?.continent ?? null,
    colo: request.cf?.colo ?? null,
    timezone: request.cf?.timezone ?? null,
    asOrganization: request.cf?.asOrganization ?? null,
    httpProtocol: request.cf?.httpProtocol ?? null,
  };
}
function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  const allowed = new Set(String(env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean));
  return allowed.has(origin) ? origin : null;
}
function withCors(response, origin) {
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Max-Age', '86400');
  headers.set('Vary', 'Origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }); }
function jsonError(message, status) { return json({ ok: false, error: message }, status); }
function parseJson(text) { try { return JSON.parse(text); } catch { throw new Error('Invalid JSON.'); } }
function safeObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function batchFromSeed(value) { return /^batch:(set_(?:0[1-9]|1[0-2]))(?::|$)/.exec(String(value ?? ''))?.[1] ?? null; }
async function batchForRun(runId, secret) { const digest = await hmac(`inhouse-batch:${runId}`, secret); const value = digest[0] * 0x1000000 + digest[1] * 0x10000 + digest[2] * 0x100 + digest[3]; return `set_${String(value % 12 + 1).padStart(2, '0')}`; }
function normalizeDemographics(value, inhouse) {
  const source = safeObject(value);
  const baseFields = ['sexAssignedAtBirth', 'genderIdentity', 'genderSelfDescription', 'education', 'educationOther', 'normalOrCorrectedVision'];
  const inhouseFields = ['name', 'email', 'age', 'nativeLanguage', 'nativeLanguageOther', 'englishProficiency', 'countryOfOrigin'];
  const normalized = {};
  for (const field of [...baseFields, ...(inhouse ? inhouseFields : [])]) normalized[field] = cleanString(source[field], field === 'email' ? 320 : 300);
  normalized.backgroundExperience = Array.isArray(source.backgroundExperience)
    ? source.backgroundExperience.map((item) => cleanString(item, 80)).filter(Boolean).slice(0, 20)
    : [];
  return normalized;
}
function validDemographics(value, inhouse) {
  const validExclusiveBackground = value.backgroundExperience.length > 0
    && (!value.backgroundExperience.includes('none') || value.backgroundExperience.length === 1);
  const baseValid = Boolean(
    value.sexAssignedAtBirth && value.genderIdentity
    && (value.genderIdentity !== 'self_describe' || value.genderSelfDescription)
    && value.education && (value.education !== 'other' || value.educationOther)
    && value.normalOrCorrectedVision && validExclusiveBackground
  );
  if (!baseValid || !inhouse) return baseValid;
  const age = Number(value.age);
  return Boolean(
    value.name && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)
    && Number.isInteger(age) && age >= 18 && age <= 100
    && value.nativeLanguage && (value.nativeLanguage !== 'other' || value.nativeLanguageOther)
    && value.englishProficiency && value.countryOfOrigin
  );
}
function normalizeCredentialUsername(value) {
  return normalizeCredentialToken(value).toLowerCase();
}
function normalizeCredentialToken(value) {
  return value.normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/[\u2010-\u2015\u2212]/g, '-').replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
}
function cleanString(value, maxLength) { return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''; }
function identifier(value) { const clean = cleanString(value, 160); return /^[A-Za-z0-9_-]{3,160}$/.test(clean) ? clean : ''; }
function isoString(value) { const clean = cleanString(value, 50); return clean && !Number.isNaN(Date.parse(clean)) ? new Date(clean).toISOString() : ''; }
function tokenTtl(env) { const value = Number(env.TOKEN_TTL_SECONDS); return Number.isFinite(value) && value >= 900 && value <= 86400 ? Math.floor(value) : 43200; }
async function readBody(request, maxBytes) {
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (length > maxBytes) throw new Error('Request body too large.');
  const text = await request.text();
  if (encoder.encode(text).byteLength > maxBytes) throw new Error('Request body too large.');
  return text;
}
async function pbkdf2(password, saltBase64, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(saltBase64), iterations }, key, 256);
  return new Uint8Array(bits);
}
function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i += 1) result |= left[i] ^ right[i];
  return result === 0;
}
function fromBase64(value) { const binary = atob(value); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }
function toBase64Url(bytes) { let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte); }); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function encodeBase64UrlText(value) { return toBase64Url(encoder.encode(value)); }
function decodeBase64UrlText(value) { const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='); return new TextDecoder().decode(fromBase64(normalized)); }
async function hmac(value, secret) { const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))); }
async function signToken(payload, secret) { const body = encodeBase64UrlText(JSON.stringify(payload)); return `${body}.${toBase64Url(await hmac(body, secret))}`; }
async function verifyToken(token, secret) {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra) return null;
  const expected = toBase64Url(await hmac(body, secret));
  if (!timingSafeEqual(encoder.encode(signature), encoder.encode(expected))) return null;
  try {
    const claims = JSON.parse(decodeBase64UrlText(body));
    if (!claims.sid || !Number.isInteger(claims.cid) || !Number.isInteger(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch { return null; }
}
async function sha256Hex(value) { const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))); return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
