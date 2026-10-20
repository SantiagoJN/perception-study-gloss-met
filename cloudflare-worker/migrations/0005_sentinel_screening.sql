ALTER TABLE study_sessions ADD COLUMN screened_out INTEGER NOT NULL DEFAULT 0
  CHECK (screened_out IN (0, 1));

ALTER TABLE study_sessions ADD COLUMN screened_out_at TEXT;

ALTER TABLE study_sessions ADD COLUMN sentinel_failures INTEGER NOT NULL DEFAULT 0
  CHECK (sentinel_failures >= 0);

ALTER TABLE study_sessions ADD COLUMN sentinels_evaluated INTEGER NOT NULL DEFAULT 0
  CHECK (sentinels_evaluated >= 0);

ALTER TABLE study_sessions ADD COLUMN screen_out_reason TEXT
  CHECK (screen_out_reason IS NULL OR screen_out_reason = 'sentinel_failures');

ALTER TABLE study_sessions ADD COLUMN screen_out_receipt_id TEXT;

CREATE UNIQUE INDEX study_sessions_screen_out_receipt_idx
  ON study_sessions (screen_out_receipt_id)
  WHERE screen_out_receipt_id IS NOT NULL;

CREATE INDEX study_sessions_screened_out_idx
  ON study_sessions (screened_out, study_type, screened_out_at);
