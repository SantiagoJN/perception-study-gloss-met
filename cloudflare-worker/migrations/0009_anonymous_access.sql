ALTER TABLE access_credentials ADD COLUMN provisioning_mode TEXT NOT NULL DEFAULT 'manual'
  CHECK (provisioning_mode IN ('manual', 'anonymous'));

ALTER TABLE access_credentials ADD COLUMN anonymous_order INTEGER
  CHECK (anonymous_order IS NULL OR anonymous_order > 0);

ALTER TABLE study_sessions ADD COLUMN anonymous_entry INTEGER NOT NULL DEFAULT 0
  CHECK (anonymous_entry IN (0, 1));

CREATE UNIQUE INDEX access_credentials_anonymous_order_idx
  ON access_credentials (assigned_study_type, anonymous_order)
  WHERE provisioning_mode = 'anonymous';

CREATE INDEX access_credentials_anonymous_pool_idx
  ON access_credentials (assigned_study_type, provisioning_mode, active, anonymous_order);
