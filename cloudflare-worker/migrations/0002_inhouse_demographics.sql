ALTER TABLE study_sessions ADD COLUMN assignment_batch TEXT
  CHECK (assignment_batch IS NULL OR assignment_batch IN ('set_01', 'set_02', 'set_03', 'set_04', 'set_05', 'set_06', 'set_07', 'set_08', 'set_09', 'set_10', 'set_11', 'set_12'));

ALTER TABLE study_sessions ADD COLUMN inhouse INTEGER NOT NULL DEFAULT 0
  CHECK (inhouse IN (0, 1));

-- Backfill existing sessions from the immutable credential assignment seed.
UPDATE study_sessions
SET assignment_batch = (
  SELECT substr(access_credentials.assignment_seed, 7, 6)
  FROM access_credentials
  WHERE access_credentials.id = study_sessions.credential_id
)
WHERE assignment_batch IS NULL;
