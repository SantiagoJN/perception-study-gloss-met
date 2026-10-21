#!/usr/bin/env python3
"""Create a private, round-robin credential pool for anonymous Prolific entry.

The Worker consumes these credentials internally; participants never see or
type them. Plaintext credentials remain under the gitignored ``private`` tree,
while D1 receives only PBKDF2 hashes and the allocation order.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import secrets
import string
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
DEFAULT_BANK = PROJECT / "private" / "credentials" / "fixed_batches_v1"
ALPHABET = string.ascii_letters + string.digits
ITERATIONS = 100_000
BATCHES = tuple(f"set_{index:02d}" for index in range(1, 13))
TESTS = {
    "test1": "pairJudgment",
    "test2": "forcedChoice",
    "test3": "sceneMatching",
    "test4": "selection",
}


def sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def private_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    path.chmod(0o600)


def random_username(used: set[str]) -> str:
    while True:
        value = "".join(secrets.choice(ALPHABET) for _ in range(10))
        if value.lower() not in used:
            used.add(value.lower())
            return value


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bank", type=Path, default=DEFAULT_BANK)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    bank = args.bank.resolve()
    source = json.loads((bank / "assignments.json").read_text(encoding="utf-8"))
    output = bank / "anonymous_v1"
    if (output / "assignments.json").exists() and not args.force:
        raise SystemExit(f"Anonymous credential pool already exists: {output}")

    used = {str(row["username"]).lower() for row in source}
    assignments: list[dict[str, object]] = []
    sql_rows: list[str] = []
    for test_key, study_type in TESTS.items():
        count = sum(row.get("test") == test_key and not row.get("internal") for row in source)
        if count < 1:
            raise SystemExit(f"No participant credentials found for {test_key}")
        text_rows: list[str] = []
        for order in range(1, count + 1):
            batch_id = BATCHES[(order - 1) % len(BATCHES)]
            username = random_username(used)
            password = username
            assignment_seed = f"batch:{batch_id}:anon:{test_key}:{username}"
            row = {
                "username": username,
                "password": password,
                "test": test_key,
                "study_type": study_type,
                "batch_id": batch_id,
                "anonymous_order": order,
                "assignment_seed": assignment_seed,
            }
            assignments.append(row)
            text_rows.append(f"{username},{password}")

            salt = secrets.token_bytes(18)
            digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS, dklen=32)
            sql_rows.append(
                "INSERT INTO access_credentials "
                "(username, password_hash, password_salt, password_iterations, assigned_study_type, "
                "assignment_seed, provisioning_mode, anonymous_order) VALUES "
                f"({sql_string(username)}, {sql_string(base64.b64encode(digest).decode())}, "
                f"{sql_string(base64.b64encode(salt).decode())}, {ITERATIONS}, {sql_string(study_type)}, "
                f"{sql_string(assignment_seed)}, 'anonymous', {order});"
            )
        private_write(bank / f"{test_key}_anon.txt", "\n".join(text_rows) + "\n")

    summary = {
        "schema_version": 1,
        "pool": "anonymous_v1",
        "credentials_per_test": {key: sum(row["test"] == key for row in assignments) for key in TESTS},
        "allocation_order": "set_01 through set_12, repeated round-robin",
        "participant_visibility": "internal only",
    }
    private_write(output / "assignments.json", json.dumps(assignments, indent=2) + "\n")
    private_write(output / "credentials.sql", "\n".join(sql_rows) + "\n")
    private_write(output / "README.json", json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
