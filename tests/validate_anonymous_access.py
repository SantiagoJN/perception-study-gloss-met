#!/usr/bin/env python3
"""Validate the anonymous credential schema and round-robin allocation query."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
MIGRATIONS = PROJECT / "cloudflare-worker" / "migrations"
PRIVATE_POOL = PROJECT / "private" / "credentials" / "fixed_batches_v1" / "anonymous_v1" / "assignments.json"
STUDY_TYPES = ("pairJudgment", "forcedChoice", "sceneMatching", "selection")

ALLOCATION_SQL = """
INSERT OR IGNORE INTO participant_mappings
  (credential_id, prolific_pid, prolific_study_id, prolific_session_id)
SELECT credential.id, ?1, ?2, ?3
FROM access_credentials AS credential
WHERE credential.provisioning_mode = 'anonymous'
  AND credential.assigned_study_type = ?4
  AND credential.active = 1
  AND NOT EXISTS (
    SELECT 1 FROM participant_mappings AS mapping
    WHERE mapping.credential_id = credential.id
  )
ORDER BY credential.anonymous_order ASC
LIMIT 1
"""


def build_database() -> sqlite3.Connection:
    database = sqlite3.connect(":memory:")
    for migration in sorted(MIGRATIONS.glob("*.sql")):
        database.executescript(migration.read_text(encoding="utf-8"))
    for order in range(1, 7):
        batch = f"set_{order:02d}"
        database.execute(
            """INSERT INTO access_credentials
               (username, password_hash, password_salt, password_iterations,
                assigned_study_type, assignment_seed, provisioning_mode, anonymous_order)
               VALUES (?, 'AA==', 'AA==', 100000, 'pairJudgment', ?, 'anonymous', ?)""",
            (f"anonymous-{order}", f"batch:{batch}:anon:test1:{order}", order),
        )
    return database


def validate_screened_out_status_migration() -> None:
    database = sqlite3.connect(":memory:")
    migrations = sorted(MIGRATIONS.glob("*.sql"))
    status_migration = next(path for path in migrations if path.name.startswith("0010_"))
    for migration in migrations[:migrations.index(status_migration)]:
        database.executescript(migration.read_text(encoding="utf-8"))
    database.execute(
        """INSERT INTO access_credentials
           (username, password_hash, password_salt, password_iterations,
            assigned_study_type, assignment_seed)
           VALUES ('migration-user', 'AA==', 'AA==', 100000,
                   'forcedChoice', 'batch:set_01:migration-user')"""
    )
    credential_id = database.execute("SELECT id FROM access_credentials").fetchone()[0]
    database.execute(
        """INSERT INTO participant_mappings
           (credential_id, prolific_pid, prolific_study_id, prolific_session_id)
           VALUES (?, 'migration-pid', 'migration-study', 'migration-session')""",
        (credential_id,),
    )
    mapping_id = database.execute("SELECT id FROM participant_mappings").fetchone()[0]
    database.execute(
        """INSERT INTO study_sessions
           (id, credential_id, participant_mapping_id, study_type, status,
            started_at, client_metadata_json, cloudflare_metadata_json,
            screened_out, screened_out_at, screen_out_reason, final_outcome)
           VALUES ('screened-session', ?, ?, 'forcedChoice', 'in_progress',
                   '2026-10-21T12:00:00.000Z', '{}', '{}', 1,
                   '2026-10-21T12:05:00.000Z', 'sentinel_failures', 'screened_out')""",
        (credential_id, mapping_id),
    )
    database.execute(
        """INSERT INTO trial_responses
           (session_id, trial_number, trial_id, response_time_ms, response_json)
           VALUES ('screened-session', 1, 'sentinel-trial', 1000, '{}')"""
    )
    database.executescript(status_migration.read_text(encoding="utf-8"))
    assert database.execute(
        "SELECT status FROM study_sessions WHERE id = 'screened-session'"
    ).fetchone()[0] == "screened_out"
    assert database.execute(
        "SELECT count(*) FROM trial_responses WHERE session_id = 'screened-session'"
    ).fetchone()[0] == 1
    assert database.execute("PRAGMA foreign_key_check").fetchall() == []
    for migration in migrations[migrations.index(status_migration) + 1:]:
        database.executescript(migration.read_text(encoding="utf-8"))
    database.execute(
        """INSERT INTO access_credentials
           (username, password_hash, password_salt, password_iterations,
            assigned_study_type, assignment_seed)
           VALUES ('context-user', 'AA==', 'AA==', 100000,
                   'contextMatching2', 'batch:set_01:context-user')"""
    )
    assert database.execute("PRAGMA foreign_key_check").fetchall() == []


def allocate(database: sqlite3.Connection, participant: str) -> str:
    identifiers = (f"pid-{participant}", "study-test1", f"session-{participant}")
    existing = database.execute(
        """SELECT credential.assignment_seed
           FROM participant_mappings AS mapping
           JOIN access_credentials AS credential ON credential.id = mapping.credential_id
           WHERE mapping.prolific_session_id = ?
              OR (mapping.prolific_pid = ? AND mapping.prolific_study_id = ?)""",
        (identifiers[2], identifiers[0], identifiers[1]),
    ).fetchone()
    if not existing:
        database.execute(ALLOCATION_SQL, (*identifiers, "pairJudgment"))
        existing = database.execute(
            """SELECT credential.assignment_seed
               FROM participant_mappings AS mapping
               JOIN access_credentials AS credential ON credential.id = mapping.credential_id
               WHERE mapping.prolific_pid = ? AND mapping.prolific_study_id = ?""",
            identifiers[:2],
        ).fetchone()
    assert existing, "Anonymous pool unexpectedly exhausted"
    return existing[0].split(":")[1]


def validate_private_pool() -> None:
    if not PRIVATE_POOL.is_file():
        return
    rows = json.loads(PRIVATE_POOL.read_text(encoding="utf-8"))
    assert rows, "The private anonymous credential pool is empty"
    assert len({str(row["username"]).lower() for row in rows}) == len(rows)
    assert len({row["assignment_seed"] for row in rows}) == len(rows)
    per_test_counts: list[int] = []
    for test_number, study_type in enumerate(STUDY_TYPES, start=1):
        selected = [row for row in rows if row["test"] == f"test{test_number}"]
        assert selected, f"The anonymous pool is empty for test{test_number}"
        per_test_counts.append(len(selected))
        assert all(row["study_type"] == study_type for row in selected)
        assert [row["anonymous_order"] for row in selected] == list(range(1, len(selected) + 1))
        expected = [f"set_{(index % 12) + 1:02d}" for index in range(len(selected))]
        assert [row["batch_id"] for row in selected] == expected
    assert len(set(per_test_counts)) == 1, "Anonymous pool sizes differ between tests"


def main() -> None:
    validate_screened_out_status_migration()
    database = build_database()
    batches = [allocate(database, name) for name in ("one", "two", "three")]
    assert batches == ["set_01", "set_02", "set_03"]
    assert allocate(database, "one") == "set_01"
    assert database.execute("SELECT count(DISTINCT credential_id) FROM participant_mappings").fetchone()[0] == 3
    validate_private_pool()
    print("Study database valid: screened-out status migration preserves responses; anonymous allocation remains stable and round-robin.")


if __name__ == "__main__":
    main()
