ALTER TABLE study_sessions ADD COLUMN sentinel_checks_evaluated INTEGER NOT NULL DEFAULT 0
  CHECK (sentinel_checks_evaluated >= 0);
