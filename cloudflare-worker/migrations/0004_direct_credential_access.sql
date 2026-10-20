ALTER TABLE study_sessions ADD COLUMN access_source TEXT NOT NULL DEFAULT 'prolific'
  CHECK (access_source IN ('prolific', 'direct', 'internal'));

UPDATE study_sessions
SET access_source = 'internal'
WHERE credential_id IN (
  SELECT id FROM access_credentials
  WHERE username IN ('gilab-inhouse', 'gilab-testing') COLLATE NOCASE
);
