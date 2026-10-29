-- D1 keeps foreign-key enforcement enabled. Defer validation until every
-- connected table has been rebuilt and renamed within this migration.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE access_credentials_context_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 100000 CHECK (password_iterations >= 100000),
  assigned_study_type TEXT NOT NULL CHECK (assigned_study_type IN ('pairJudgment', 'forcedChoice', 'sceneMatching', 'contextMatching2', 'selection')),
  assignment_seed TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  disabled_at TEXT,
  provisioning_mode TEXT NOT NULL DEFAULT 'manual' CHECK (provisioning_mode IN ('manual', 'anonymous')),
  anonymous_order INTEGER CHECK (anonymous_order IS NULL OR anonymous_order > 0)
);

INSERT INTO access_credentials_context_v2
SELECT id, username, password_hash, password_salt, password_iterations,
       assigned_study_type, assignment_seed, active, created_at, disabled_at,
       provisioning_mode, anonymous_order
FROM access_credentials;

CREATE TABLE participant_mappings_context_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id INTEGER NOT NULL UNIQUE REFERENCES access_credentials_context_v2(id),
  prolific_pid TEXT NOT NULL,
  prolific_study_id TEXT NOT NULL,
  prolific_session_id TEXT NOT NULL UNIQUE,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (prolific_pid, prolific_study_id)
);

INSERT INTO participant_mappings_context_v2 SELECT * FROM participant_mappings;

CREATE TABLE study_sessions_context_v2 (
  id TEXT PRIMARY KEY,
  credential_id INTEGER NOT NULL REFERENCES access_credentials_context_v2(id),
  participant_mapping_id INTEGER NOT NULL REFERENCES participant_mappings_context_v2(id),
  study_type TEXT NOT NULL CHECK (study_type IN ('pairJudgment', 'forcedChoice', 'sceneMatching', 'contextMatching2', 'selection')),
  status TEXT NOT NULL DEFAULT 'authenticated' CHECK (status IN ('authenticated', 'in_progress', 'completed', 'screened_out')),
  schema_version TEXT NOT NULL DEFAULT '2026-10-19.1',
  started_at TEXT NOT NULL,
  authenticated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  received_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  demographics_skipped INTEGER CHECK (demographics_skipped IN (0, 1)),
  demographics_json TEXT CHECK (demographics_json IS NULL OR json_valid(demographics_json)),
  training_json TEXT CHECK (training_json IS NULL OR json_valid(training_json)),
  client_metadata_json TEXT NOT NULL CHECK (json_valid(client_metadata_json)),
  cloudflare_metadata_json TEXT NOT NULL CHECK (json_valid(cloudflare_metadata_json)),
  response_count INTEGER NOT NULL DEFAULT 0 CHECK (response_count >= 0),
  payload_sha256 TEXT UNIQUE,
  receipt_id TEXT UNIQUE,
  assignment_batch TEXT CHECK (assignment_batch IS NULL OR assignment_batch IN ('set_01', 'set_02', 'set_03', 'set_04', 'set_05', 'set_06', 'set_07', 'set_08', 'set_09', 'set_10', 'set_11', 'set_12')),
  inhouse INTEGER NOT NULL DEFAULT 0 CHECK (inhouse IN (0, 1)),
  study_run_id TEXT,
  access_source TEXT NOT NULL DEFAULT 'prolific' CHECK (access_source IN ('prolific', 'direct', 'internal')),
  screened_out INTEGER NOT NULL DEFAULT 0 CHECK (screened_out IN (0, 1)),
  screened_out_at TEXT,
  sentinel_failures INTEGER NOT NULL DEFAULT 0 CHECK (sentinel_failures >= 0),
  sentinels_evaluated INTEGER NOT NULL DEFAULT 0 CHECK (sentinels_evaluated >= 0),
  screen_out_reason TEXT CHECK (screen_out_reason IS NULL OR screen_out_reason = 'sentinel_failures'),
  screen_out_receipt_id TEXT,
  sentinel_checks_evaluated INTEGER NOT NULL DEFAULT 0 CHECK (sentinel_checks_evaluated >= 0),
  demographics_saved_at TEXT,
  consented INTEGER NOT NULL DEFAULT 0 CHECK (consented IN (0, 1)),
  consented_at TEXT,
  final_outcome TEXT CHECK (final_outcome IS NULL OR final_outcome IN ('completed', 'screened_out')),
  anonymous_entry INTEGER NOT NULL DEFAULT 0 CHECK (anonymous_entry IN (0, 1))
);

CREATE TABLE trial_responses_context_v2 (
  session_id TEXT NOT NULL REFERENCES study_sessions_context_v2(id) ON DELETE CASCADE,
  trial_number INTEGER NOT NULL CHECK (trial_number BETWEEN 1 AND 150),
  trial_id TEXT NOT NULL,
  response_time_ms INTEGER NOT NULL CHECK (response_time_ms >= 0),
  is_sentinel INTEGER NOT NULL DEFAULT 0 CHECK (is_sentinel IN (0, 1)),
  sentinel_id TEXT,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (session_id, trial_number)
);

INSERT INTO study_sessions_context_v2 SELECT * FROM study_sessions;
INSERT INTO trial_responses_context_v2 SELECT * FROM trial_responses;
DROP TABLE trial_responses;
DROP TABLE study_sessions;
DROP TABLE participant_mappings;
DROP TABLE access_credentials;
ALTER TABLE access_credentials_context_v2 RENAME TO access_credentials;
ALTER TABLE participant_mappings_context_v2 RENAME TO participant_mappings;
ALTER TABLE study_sessions_context_v2 RENAME TO study_sessions;
ALTER TABLE trial_responses_context_v2 RENAME TO trial_responses;

CREATE UNIQUE INDEX access_credentials_anonymous_order_idx
  ON access_credentials (assigned_study_type, anonymous_order)
  WHERE provisioning_mode = 'anonymous';
CREATE INDEX access_credentials_anonymous_pool_idx
  ON access_credentials (assigned_study_type, provisioning_mode, active, anonymous_order);
CREATE INDEX study_sessions_credential_idx ON study_sessions (credential_id, status, updated_at);
CREATE INDEX study_sessions_mapping_idx ON study_sessions (participant_mapping_id, status, updated_at);
CREATE INDEX study_sessions_run_idx ON study_sessions (study_run_id, study_type, status);
CREATE UNIQUE INDEX study_sessions_screen_out_receipt_idx ON study_sessions (screen_out_receipt_id) WHERE screen_out_receipt_id IS NOT NULL;
CREATE INDEX study_sessions_screened_out_idx ON study_sessions (screened_out, study_type, screened_out_at);
CREATE INDEX trial_responses_trial_idx ON trial_responses (trial_id);
