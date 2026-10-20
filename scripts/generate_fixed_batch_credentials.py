#!/usr/bin/env python3
"""Generate private Prolific credentials tied to the fixed 12 x 50 sets.

The participant-facing password intentionally equals the username so Prolific
can distribute a two-column ``username,password`` file while the study UI only
asks participants to enter the username. Plaintext files stay under the
gitignored ``private/credentials`` directory; D1 receives only salted hashes.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import json
import secrets
import string
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = PROJECT / "private" / "credentials" / "fixed_batches_v1"
MANIFEST = PROJECT / "public" / "fixed_trial_groups.json"
ALPHABET = string.ascii_letters + string.digits
USERS_PER_BATCH = 10
ITERATIONS = 100_000
TESTS = {
    "test1": "pairJudgment",
    "test2": "forcedChoice",
    "test3": "sceneMatching",
    "test4": "selection",
}
BATCHES = tuple(f"set_{index:02d}" for index in range(1, 13))
INTERNAL_USERS = (
    ("gilab-inhouse", "set_01"),
    ("gilab-testing", "set_02"),
)


def random_username(used: set[str]) -> str:
    while True:
        username = "".join(secrets.choice(ALPHABET) for _ in range(10))
        if username.lower() not in used:
            used.add(username.lower())
            return username


def sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def private_write(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(0o600)


def prolific_rows(assignments: list[dict[str, object]], test_key: str) -> list[str]:
    """Return credentials interleaved by batch for balanced sequential use."""
    batch_order = {batch_id: index for index, batch_id in enumerate(BATCHES)}
    selected = [row for row in assignments if row["test"] == test_key]
    selected.sort(key=lambda row: (int(row["slot"]), batch_order[str(row["batch_id"])]))
    return [f"{row['username']},{row['password']}" for row in selected]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--force", action="store_true", help="Replace an existing credential set.")
    args = parser.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    expected_sets = list(BATCHES)
    for test_key in TESTS:
        observed = [group["set_id"] for group in manifest["tests"][test_key]["groups"]]
        if observed != expected_sets:
            raise SystemExit(f"{test_key}: fixed-set manifest does not contain set_01 through set_12")

    output = args.output.resolve()
    assignments_path = output / "assignments.json"
    if assignments_path.exists() and not args.force:
        raise SystemExit(f"{output} already contains credentials; use --force only if they must be invalidated and replaced")
    output.mkdir(parents=True, exist_ok=True)
    output.chmod(0o700)

    used: set[str] = {username.lower() for username, _ in INTERNAL_USERS}
    assignments: list[dict[str, object]] = []
    for test_key, study_type in TESTS.items():
        for batch_id in expected_sets:
            for slot in range(1, USERS_PER_BATCH + 1):
                username = random_username(used)
                assignments.append({
                    "username": username,
                    "password": username,
                    "test": test_key,
                    "study_type": study_type,
                    "batch_id": batch_id,
                    "slot": slot,
                    "assignment_seed": f"batch:{batch_id}:{test_key}:{username}",
                    "internal": False,
                })

    for username, batch_id in INTERNAL_USERS:
        assignments.append({
            "username": username,
            "password": username,
            "test": "all",
            # The Worker explicitly treats these two accounts as universal.
            "study_type": "pairJudgment",
            "batch_id": batch_id,
            "slot": 0,
            "assignment_seed": f"batch:{batch_id}:internal:{username}",
            "internal": True,
        })

    sql_rows: list[str] = []
    mapping_rows: list[list[object]] = []
    for assignment in assignments:
        username = str(assignment["username"])
        password = str(assignment["password"])
        salt = secrets.token_bytes(18)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS, dklen=32)
        sql_rows.append(
            "INSERT INTO access_credentials "
            "(username, password_hash, password_salt, password_iterations, assigned_study_type, assignment_seed) VALUES "
            f"({sql_string(username)}, {sql_string(base64.b64encode(digest).decode())}, "
            f"{sql_string(base64.b64encode(salt).decode())}, {ITERATIONS}, "
            f"{sql_string(str(assignment['study_type']))}, {sql_string(str(assignment['assignment_seed']))});"
        )
        mapping_rows.append([
            username,
            password,
            assignment["test"],
            assignment["study_type"],
            assignment["batch_id"],
            assignment["slot"],
            assignment["assignment_seed"],
            assignment["internal"],
        ])

    private_write(assignments_path, json.dumps(assignments, indent=2) + "\n")
    private_write(output / "credentials.sql", "\n".join(sql_rows) + "\n")

    mapping_path = output / "credential_batch_mapping.csv"
    with mapping_path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(["username", "password", "test", "study_type", "batch_id", "slot", "assignment_seed", "internal"])
        writer.writerows(mapping_rows)
    mapping_path.chmod(0o600)

    for test_key in TESTS:
        rows = prolific_rows(assignments, test_key)
        private_write(output / f"{test_key}.txt", "\n".join(rows) + "\n")
    private_write(output / "internal_users.txt", "\n".join(f"{username},{username}" for username, _ in INTERNAL_USERS) + "\n")

    summary = {
        "schema_version": 1,
        "created_from": str(MANIFEST.relative_to(PROJECT)),
        "tests": {test_key: {"batches": 12, "users_per_batch": USERS_PER_BATCH, "credentials": 120} for test_key in TESTS},
        "participant_credentials": 480,
        "internal_credentials": len(INTERNAL_USERS),
        "total_credentials": len(assignments),
        "password_policy": "password equals username; the web requests username only",
        "prolific_txt_order": "round-robin by slot, then set_01 through set_12",
    }
    private_write(output / "README.json", json.dumps(summary, indent=2) + "\n")
    print(f"Generated {len(assignments)} private credentials in {output}")


if __name__ == "__main__":
    main()
