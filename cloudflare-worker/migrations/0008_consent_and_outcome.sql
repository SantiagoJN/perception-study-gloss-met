ALTER TABLE study_sessions ADD COLUMN consented INTEGER NOT NULL DEFAULT 0
  CHECK (consented IN (0, 1));

ALTER TABLE study_sessions ADD COLUMN consented_at TEXT;

-- Keep the legacy status values for backwards compatibility while making the
-- terminal outcome explicit and unambiguous for exports and analysis.
ALTER TABLE study_sessions ADD COLUMN final_outcome TEXT
  CHECK (final_outcome IS NULL OR final_outcome IN ('completed', 'screened_out'));
