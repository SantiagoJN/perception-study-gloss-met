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
    assert len(rows) == 680
    assert len({str(row["username"]).lower() for row in rows}) == len(rows)
    for test_number, study_type in enumerate(STUDY_TYPES, start=1):
        selected = [row for row in rows if row["test"] == f"test{test_number}"]
        assert len(selected) == 170
        assert all(row["study_type"] == study_type for row in selected)
        assert [row["anonymous_order"] for row in selected] == list(range(1, 171))
        expected = [f"set_{(index % 12) + 1:02d}" for index in range(170)]
        assert [row["batch_id"] for row in selected] == expected


def main() -> None:
    database = build_database()
    batches = [allocate(database, name) for name in ("one", "two", "three")]
    assert batches == ["set_01", "set_02", "set_03"]
    assert allocate(database, "one") == "set_01"
    assert database.execute("SELECT count(DISTINCT credential_id) FROM participant_mappings").fetchone()[0] == 3
    validate_private_pool()
    print("Anonymous access valid: stable allocation, unique credentials, and round-robin batches.")


if __name__ == "__main__":
    main()
