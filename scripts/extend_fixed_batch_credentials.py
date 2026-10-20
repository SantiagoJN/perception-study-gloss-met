#!/usr/bin/env python3
"""Append participant credentials to the fixed-batch credential bank.

The script preserves every existing credential, balances each extension across
the 12 fixed trial sets, writes an extension-only SQL file for D1, and refreshes
the private merged mapping/TXT files used for Prolific.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import json
import secrets
import string
from collections import Counter
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
DEFAULT_BANK = PROJECT / "private" / "credentials" / "fixed_batches_v1"
ALPHABET = string.ascii_letters + string.digits
ITERATIONS = 100_000
TESTS = {
    "test1": "pairJudgment",
    "test2": "forcedChoice",
    "test3": "sceneMatching",
    "test4": "selection",
}
BATCHES = tuple(f"set_{index:02d}" for index in range(1, 13))


def random_username(used: set[str]) -> str:
    while True:
        username = "".join(secrets.choice(ALPHABET) for _ in range(10))
        if username.lower() not in used:
            used.add(username.lower())
            return username


def sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def private_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(path)
    path.chmod(0o600)


def mapping_csv(assignments: list[dict[str, object]]) -> str:
    from io import StringIO

    stream = StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(["username", "password", "test", "study_type", "batch_id", "slot", "assignment_seed", "internal"])
    for row in assignments:
        writer.writerow([
            row["username"], row["password"], row["test"], row["study_type"],
            row["batch_id"], row["slot"], row["assignment_seed"], row["internal"],
        ])
    return stream.getvalue()


def prolific_rows(assignments: list[dict[str, object]], test_key: str) -> list[str]:
    """Return credentials interleaved by batch for balanced sequential use."""
    batch_order = {batch_id: index for index, batch_id in enumerate(BATCHES)}
    selected = [row for row in assignments if row["test"] == test_key]
    selected.sort(key=lambda row: (int(row["slot"]), batch_order[str(row["batch_id"])]))
    return [f"{row['username']},{row['password']}" for row in selected]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bank", type=Path, default=DEFAULT_BANK)
    parser.add_argument("--per-test", type=int, default=50)
    parser.add_argument("--tag", required=True, help="Unique extension directory name.")
    args = parser.parse_args()
    if args.per_test < 1:
        raise SystemExit("--per-test must be positive")
    if not args.tag.replace("-", "").replace("_", "").isalnum():
        raise SystemExit("--tag must contain only letters, numbers, hyphens, or underscores")

    bank = args.bank.resolve()
    assignments_path = bank / "assignments.json"
    assignments = json.loads(assignments_path.read_text(encoding="utf-8"))
    if not isinstance(assignments, list) or not assignments:
        raise SystemExit(f"Invalid credential bank: {assignments_path}")

    extension = bank / "extensions" / args.tag
    if extension.exists():
        raise SystemExit(f"Extension already exists: {extension}")

    used = {str(row["username"]).lower() for row in assignments}
    seeds = {str(row["assignment_seed"]) for row in assignments}
    new_assignments: list[dict[str, object]] = []
    sql_rows: list[str] = []

    quotient, remainder = divmod(args.per_test, len(BATCHES))
    for test_offset, (test_key, study_type) in enumerate(TESTS.items()):
        # Rotate the batches receiving the remainder to avoid making the same
        # fixed sets systematically larger in every test.
        extra_start = (test_offset * 3) % len(BATCHES)
        extra_batches = {BATCHES[(extra_start + index) % len(BATCHES)] for index in range(remainder)}
        for batch_id in BATCHES:
            count = quotient + int(batch_id in extra_batches)
            existing_slots = [
                int(row["slot"])
                for row in assignments
                if row["test"] == test_key and row["batch_id"] == batch_id and not row["internal"]
            ]
            first_slot = max(existing_slots, default=0) + 1
            for slot in range(first_slot, first_slot + count):
                username = random_username(used)
                assignment_seed = f"batch:{batch_id}:{test_key}:{username}"
                if assignment_seed in seeds:
                    raise RuntimeError("Unexpected assignment-seed collision")
                seeds.add(assignment_seed)
                row = {
                    "username": username,
                    "password": username,
                    "test": test_key,
                    "study_type": study_type,
                    "batch_id": batch_id,
                    "slot": slot,
                    "assignment_seed": assignment_seed,
                    "internal": False,
                }
                new_assignments.append(row)

                salt = secrets.token_bytes(18)
                digest = hashlib.pbkdf2_hmac("sha256", username.encode(), salt, ITERATIONS, dklen=32)
                sql_rows.append(
                    "INSERT INTO access_credentials "
                    "(username, password_hash, password_salt, password_iterations, assigned_study_type, assignment_seed) VALUES "
                    f"({sql_string(username)}, {sql_string(base64.b64encode(digest).decode())}, "
                    f"{sql_string(base64.b64encode(salt).decode())}, {ITERATIONS}, "
                    f"{sql_string(study_type)}, {sql_string(assignment_seed)});"
                )
    if len(new_assignments) != args.per_test * len(TESTS):
        raise RuntimeError("Generated credential count does not match the request")

    merged = assignments + new_assignments
    counts = Counter(str(row["test"]) for row in merged if not row["internal"])
    batch_counts = {
        test_key: {
            batch_id: sum(
                row["test"] == test_key and row["batch_id"] == batch_id and not row["internal"]
                for row in merged
            )
            for batch_id in BATCHES
        }
        for test_key in TESTS
    }

    extension_summary = {
        "schema_version": 1,
        "tag": args.tag,
        "credentials_per_test": args.per_test,
        "new_credentials": len(new_assignments),
        "batch_counts_after_extension": batch_counts,
    }
    private_write(extension / "assignments.json", json.dumps(new_assignments, indent=2) + "\n")
    private_write(extension / "credentials.sql", "\n".join(sql_rows) + "\n")
    private_write(extension / "credential_batch_mapping.csv", mapping_csv(new_assignments))
    private_write(extension / "README.json", json.dumps(extension_summary, indent=2) + "\n")
    for test_key in TESTS:
        rows = prolific_rows(new_assignments, test_key)
        private_write(extension / f"{test_key}.txt", "\n".join(rows) + "\n")

    private_write(assignments_path, json.dumps(merged, indent=2) + "\n")
    private_write(bank / "credential_batch_mapping.csv", mapping_csv(merged))
    for test_key in TESTS:
        rows = prolific_rows(merged, test_key)
        private_write(bank / f"{test_key}.txt", "\n".join(rows) + "\n")

    readme_path = bank / "README.json"
    readme = json.loads(readme_path.read_text(encoding="utf-8"))
    readme["tests"] = {
        test_key: {
            "batches": len(BATCHES),
            "credentials": counts[test_key],
            "credentials_per_batch_min": min(batch_counts[test_key].values()),
            "credentials_per_batch_max": max(batch_counts[test_key].values()),
        }
        for test_key in TESTS
    }
    readme["participant_credentials"] = sum(counts.values())
    readme["total_credentials"] = len(merged)
    readme["prolific_txt_order"] = "round-robin by slot, then set_01 through set_12"
    readme.setdefault("extensions", []).append({
        "tag": args.tag,
        "credentials_per_test": args.per_test,
        "new_credentials": len(new_assignments),
    })
    private_write(readme_path, json.dumps(readme, indent=2) + "\n")

    print(json.dumps(extension_summary, indent=2))


if __name__ == "__main__":
    main()
