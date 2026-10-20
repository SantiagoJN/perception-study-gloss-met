ALTER TABLE study_sessions ADD COLUMN study_run_id TEXT;

CREATE INDEX study_sessions_run_idx
  ON study_sessions (study_run_id, study_type, status);
