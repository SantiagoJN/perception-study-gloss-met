#!/usr/bin/env python3
"""Extend the private anonymous-entry credential pool without invalidating it."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import secrets
import string
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any


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


def credential_sql(row: dict[str, Any]) -> str:
    salt = secrets.token_bytes(18)
    digest = hashlib.pbkdf2_hmac(
        "sha256", str(row["password"]).encode(), salt, ITERATIONS, dklen=32
    )
    return (
        "INSERT INTO access_credentials "
        "(username, password_hash, password_salt, password_iterations, assigned_study_type, "
        "assignment_seed, provisioning_mode, anonymous_order) VALUES "
        f"({sql_string(str(row['username']))}, {sql_string(base64.b64encode(digest).decode())}, "
        f"{sql_string(base64.b64encode(salt).decode())}, {ITERATIONS}, "
        f"{sql_string(str(row['study_type']))}, {sql_string(str(row['assignment_seed']))}, "
        f"'anonymous', {int(row['anonymous_order'])});"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bank", type=Path, default=DEFAULT_BANK)
    parser.add_argument("--target-per-test", type=int, required=True)
    parser.add_argument("--tag", required=True)
    args = parser.parse_args()

    if args.target_per_test < 1:
        raise SystemExit("--target-per-test must be positive")
    if not args.tag.replace("-", "").replace("_", "").isalnum():
        raise SystemExit("--tag must contain only letters, digits, hyphens or underscores")

    bank = args.bank.resolve()
    pool = bank / "anonymous_v1"
    assignments_path = pool / "assignments.json"
    existing = json.loads(assignments_path.read_text(encoding="utf-8"))
    if not isinstance(existing, list):
        raise SystemExit(f"Invalid anonymous assignment bank: {assignments_path}")

    extension = pool / "extensions" / args.tag
    if extension.exists():
        raise SystemExit(f"Anonymous extension already exists: {extension}")

    manual = json.loads((bank / "assignments.json").read_text(encoding="utf-8"))
    used = {str(row["username"]).lower() for row in [*manual, *existing]}
    if len(used) != len(manual) + len(existing):
        raise SystemExit("Duplicate usernames already exist in the credential bank")

    new_rows: list[dict[str, Any]] = []
    for test_key, study_type in TESTS.items():
        current = sorted(
            (row for row in existing if row.get("test") == test_key),
            key=lambda row: int(row["anonymous_order"]),
        )
        orders = [int(row["anonymous_order"]) for row in current]
        if orders != list(range(1, len(current) + 1)):
            raise SystemExit(f"Non-contiguous anonymous order for {test_key}")
        if len(current) > args.target_per_test:
            raise SystemExit(
                f"{test_key} already has {len(current)} credentials, above the requested target"
            )
        for order in range(len(current) + 1, args.target_per_test + 1):
            username = random_username(used)
            batch_id = BATCHES[(order - 1) % len(BATCHES)]
            new_rows.append({
                "username": username,
                "password": username,
                "test": test_key,
                "study_type": study_type,
                "batch_id": batch_id,
                "anonymous_order": order,
                "assignment_seed": f"batch:{batch_id}:anon:{test_key}:{username}",
            })

    workers = min(32, os.cpu_count() or 1)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        sql_rows = list(executor.map(credential_sql, new_rows))

    merged = [*existing, *new_rows]
    for test_key in TESTS:
        rows = sorted(
            (row for row in merged if row["test"] == test_key),
            key=lambda row: int(row["anonymous_order"]),
        )
        private_write(
            bank / f"{test_key}_anon.txt",
            "".join(f"{row['username']},{row['password']}\n" for row in rows),
        )

    summary = {
        "schema_version": 1,
        "pool": "anonymous_v1",
        "credentials_per_test": {
            key: sum(row["test"] == key for row in merged) for key in TESTS
        },
        "allocation_order": "set_01 through set_12, repeated round-robin",
        "participant_visibility": "internal only",
    }
    extension_summary = {
        "schema_version": 1,
        "tag": args.tag,
        "target_per_test": args.target_per_test,
        "new_credentials": len(new_rows),
        "new_credentials_per_test": {
            key: sum(row["test"] == key for row in new_rows) for key in TESTS
        },
    }
    private_write(assignments_path, json.dumps(merged, indent=2) + "\n")
    private_write(pool / "README.json", json.dumps(summary, indent=2) + "\n")
    private_write(extension / "assignments.json", json.dumps(new_rows, indent=2) + "\n")
    private_write(extension / "credentials.sql", "\n".join(sql_rows) + "\n")
    private_write(extension / "README.json", json.dumps(extension_summary, indent=2) + "\n")
    print(json.dumps({**extension_summary, "workers": workers}, indent=2))


if __name__ == "__main__":
    main()
