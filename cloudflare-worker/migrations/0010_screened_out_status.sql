CREATE TABLE study_sessions_status_v2 (
  id TEXT PRIMARY KEY,
  credential_id INTEGER NOT NULL REFERENCES access_credentials(id),
  participant_mapping_id INTEGER NOT NULL REFERENCES participant_mappings(id),
  study_type TEXT NOT NULL CHECK (study_type IN ('pairJudgment', 'forcedChoice', 'sceneMatching', 'selection')),
  status TEXT NOT NULL DEFAULT 'authenticated'
    CHECK (status IN ('authenticated', 'in_progress', 'completed', 'screened_out')),
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
  assignment_batch TEXT
    CHECK (assignment_batch IS NULL OR assignment_batch IN ('set_01', 'set_02', 'set_03', 'set_04', 'set_05', 'set_06', 'set_07', 'set_08', 'set_09', 'set_10', 'set_11', 'set_12')),
  inhouse INTEGER NOT NULL DEFAULT 0 CHECK (inhouse IN (0, 1)),
  study_run_id TEXT,
  access_source TEXT NOT NULL DEFAULT 'prolific'
    CHECK (access_source IN ('prolific', 'direct', 'internal')),
  screened_out INTEGER NOT NULL DEFAULT 0 CHECK (screened_out IN (0, 1)),
  screened_out_at TEXT,
  sentinel_failures INTEGER NOT NULL DEFAULT 0 CHECK (sentinel_failures >= 0),
  sentinels_evaluated INTEGER NOT NULL DEFAULT 0 CHECK (sentinels_evaluated >= 0),
  screen_out_reason TEXT
    CHECK (screen_out_reason IS NULL OR screen_out_reason = 'sentinel_failures'),
  screen_out_receipt_id TEXT,
  sentinel_checks_evaluated INTEGER NOT NULL DEFAULT 0 CHECK (sentinel_checks_evaluated >= 0),
  demographics_saved_at TEXT,
  consented INTEGER NOT NULL DEFAULT 0 CHECK (consented IN (0, 1)),
  consented_at TEXT,
  final_outcome TEXT
    CHECK (final_outcome IS NULL OR final_outcome IN ('completed', 'screened_out')),
  anonymous_entry INTEGER NOT NULL DEFAULT 0 CHECK (anonymous_entry IN (0, 1))
);

CREATE TABLE trial_responses_status_v2 (
  session_id TEXT NOT NULL REFERENCES study_sessions_status_v2(id) ON DELETE CASCADE,
  trial_number INTEGER NOT NULL CHECK (trial_number BETWEEN 1 AND 150),
  trial_id TEXT NOT NULL,
  response_time_ms INTEGER NOT NULL CHECK (response_time_ms >= 0),
  is_sentinel INTEGER NOT NULL DEFAULT 0 CHECK (is_sentinel IN (0, 1)),
  sentinel_id TEXT,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (session_id, trial_number)
);

INSERT INTO study_sessions_status_v2 (
  id, credential_id, participant_mapping_id, study_type, status,
  schema_version, started_at, authenticated_at, completed_at, received_at,
  updated_at, demographics_skipped, demographics_json, training_json,
  client_metadata_json, cloudflare_metadata_json, response_count,
  payload_sha256, receipt_id, assignment_batch, inhouse, study_run_id,
  access_source, screened_out, screened_out_at, sentinel_failures,
  sentinels_evaluated, screen_out_reason, screen_out_receipt_id,
  sentinel_checks_evaluated, demographics_saved_at, consented, consented_at,
  final_outcome, anonymous_entry
)
SELECT
  id, credential_id, participant_mapping_id, study_type,
  CASE
    WHEN screened_out = 1 OR final_outcome = 'screened_out' THEN 'screened_out'
    ELSE status
  END,
  schema_version, started_at, authenticated_at, completed_at, received_at,
  updated_at, demographics_skipped, demographics_json, training_json,
  client_metadata_json, cloudflare_metadata_json, response_count,
  payload_sha256, receipt_id, assignment_batch, inhouse, study_run_id,
  access_source, screened_out, screened_out_at, sentinel_failures,
  sentinels_evaluated, screen_out_reason, screen_out_receipt_id,
  sentinel_checks_evaluated, demographics_saved_at, consented, consented_at,
  final_outcome, anonymous_entry
FROM study_sessions;

INSERT INTO trial_responses_status_v2 (
  session_id, trial_number, trial_id, response_time_ms, is_sentinel,
  sentinel_id, response_json, received_at
)
SELECT
  session_id, trial_number, trial_id, response_time_ms, is_sentinel,
  sentinel_id, response_json, received_at
FROM trial_responses;

DROP TABLE trial_responses;
DROP TABLE study_sessions;
ALTER TABLE study_sessions_status_v2 RENAME TO study_sessions;
ALTER TABLE trial_responses_status_v2 RENAME TO trial_responses;

CREATE INDEX study_sessions_credential_idx
  ON study_sessions (credential_id, status, updated_at);
CREATE INDEX study_sessions_mapping_idx
  ON study_sessions (participant_mapping_id, status, updated_at);
CREATE INDEX study_sessions_run_idx
  ON study_sessions (study_run_id, study_type, status);
CREATE UNIQUE INDEX study_sessions_screen_out_receipt_idx
  ON study_sessions (screen_out_receipt_id)
  WHERE screen_out_receipt_id IS NOT NULL;
CREATE INDEX study_sessions_screened_out_idx
  ON study_sessions (screened_out, study_type, screened_out_at);
CREATE INDEX trial_responses_trial_idx
  ON trial_responses (trial_id);
