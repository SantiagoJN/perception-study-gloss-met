#!/usr/bin/env python3
"""Generate independent direct and anonymous credential pools for Test 3.2."""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import string
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
BANK = PROJECT / "private" / "credentials" / "fixed_batches_v1"
ALPHABET = string.ascii_letters + string.digits
BATCHES = tuple(f"set_{index:02d}" for index in range(1, 13))
ITERATIONS = 100_000
DIRECT_COUNT = 171
ANONYMOUS_COUNT = 3000


def quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def username(used: set[str]) -> str:
    while True:
        value = "".join(secrets.choice(ALPHABET) for _ in range(10))
        if value.lower() not in used:
            used.add(value.lower())
            return value


def credential_sql(name: str, seed: str, mode: str, order: int | None) -> str:
    salt = secrets.token_bytes(18)
    digest = hashlib.pbkdf2_hmac("sha256", name.encode(), salt, ITERATIONS, 32)
    fields = "username, password_hash, password_salt, password_iterations, assigned_study_type, assignment_seed, provisioning_mode"
    values = f"{quote(name)}, {quote(base64.b64encode(digest).decode())}, {quote(base64.b64encode(salt).decode())}, {ITERATIONS}, 'contextMatching2', {quote(seed)}, {quote(mode)}"
    if order is not None:
        fields += ", anonymous_order"
        values += f", {order}"
    return f"INSERT INTO access_credentials ({fields}) VALUES ({values});"


def main() -> None:
    target_files = [BANK / "test3_2.txt", BANK / "test3_2_anon.txt", BANK / "test3_2_credentials.sql"]
    if any(path.exists() for path in target_files):
        raise SystemExit("Test 3.2 credentials already exist; refusing to replace participant identities.")
    manifest = json.loads((PROJECT / "public" / "fixed_trial_groups.json").read_text())
    groups = manifest["tests"]["test3_2"]["groups"]
    if [row["set_id"] for row in groups] != list(BATCHES) or any(len(row["trial_ids"]) != 50 for row in groups):
        raise SystemExit("The Test 3.2 fixed batches are not the expected 12 x 50 design.")
    used: set[str] = set()
    for path in BANK.glob("test*.txt"):
        for line in path.read_text().splitlines():
            if line.strip(): used.add(line.split(",", 1)[0].strip().lower())
    direct_lines = []
    anonymous_lines = []
    sql = []
    for index in range(DIRECT_COUNT):
        name = username(used)
        batch = BATCHES[index % len(BATCHES)]
        seed = f"batch:{batch}:test3_2:{name}"
        direct_lines.append(f"{name},{name}")
        sql.append(credential_sql(name, seed, "manual", None))
    for index in range(ANONYMOUS_COUNT):
        order = index + 1
        name = username(used)
        batch = BATCHES[index % len(BATCHES)]
        seed = f"batch:{batch}:anon:test3_2:{name}"
        anonymous_lines.append(f"{name},{name}")
        sql.append(credential_sql(name, seed, "anonymous", order))
    for path, content in zip(target_files, [direct_lines, anonymous_lines, sql]):
        path.write_text("\n".join(content) + "\n", encoding="utf-8")
        path.chmod(0o600)
    print(json.dumps({"test": "test3_2", "study_type": "contextMatching2", "direct": DIRECT_COUNT, "anonymous": ANONYMOUS_COUNT, "allocation": "round-robin set_01..set_12"}, indent=2))


if __name__ == "__main__":
    main()
