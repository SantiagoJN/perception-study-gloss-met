PRAGMA foreign_keys = ON;

CREATE TABLE access_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 100000 CHECK (password_iterations >= 100000),
  assigned_study_type TEXT NOT NULL CHECK (assigned_study_type IN ('pairJudgment', 'forcedChoice', 'sceneMatching', 'selection')),
  assignment_seed TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  disabled_at TEXT
);

CREATE TABLE participant_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id INTEGER NOT NULL UNIQUE REFERENCES access_credentials(id),
  prolific_pid TEXT NOT NULL,
  prolific_study_id TEXT NOT NULL,
  prolific_session_id TEXT NOT NULL UNIQUE,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (prolific_pid, prolific_study_id)
);

CREATE TABLE study_sessions (
  id TEXT PRIMARY KEY,
  credential_id INTEGER NOT NULL REFERENCES access_credentials(id),
  participant_mapping_id INTEGER NOT NULL REFERENCES participant_mappings(id),
  study_type TEXT NOT NULL CHECK (study_type IN ('pairJudgment', 'forcedChoice', 'sceneMatching', 'selection')),
  status TEXT NOT NULL DEFAULT 'authenticated' CHECK (status IN ('authenticated', 'in_progress', 'completed')),
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
  receipt_id TEXT UNIQUE
);

CREATE TABLE trial_responses (
  session_id TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  trial_number INTEGER NOT NULL CHECK (trial_number BETWEEN 1 AND 150),
  trial_id TEXT NOT NULL,
  response_time_ms INTEGER NOT NULL CHECK (response_time_ms >= 0),
  is_sentinel INTEGER NOT NULL DEFAULT 0 CHECK (is_sentinel IN (0, 1)),
  sentinel_id TEXT,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (session_id, trial_number)
);

CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  username_normalized TEXT NOT NULL,
  successful INTEGER NOT NULL CHECK (successful IN (0, 1)),
  client_fingerprint_hash TEXT NOT NULL,
  country TEXT,
  user_agent TEXT
);

CREATE INDEX login_attempts_rate_limit_idx ON login_attempts (client_fingerprint_hash, attempted_at, successful);
CREATE INDEX login_attempts_username_idx ON login_attempts (username_normalized, attempted_at, successful);
CREATE INDEX study_sessions_credential_idx ON study_sessions (credential_id, status, updated_at);
CREATE INDEX study_sessions_mapping_idx ON study_sessions (participant_mapping_id, status, updated_at);
CREATE INDEX trial_responses_trial_idx ON trial_responses (trial_id);
