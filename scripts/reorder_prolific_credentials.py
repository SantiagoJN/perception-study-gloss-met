#!/usr/bin/env python3
"""Rewrite existing Prolific TXT files in round-robin batch order."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
DEFAULT_BANK = PROJECT / "private" / "credentials" / "fixed_batches_v1"
TESTS = ("test1", "test2", "test3", "test4")
BATCHES = tuple(f"set_{index:02d}" for index in range(1, 13))


def private_write(path: Path, content: str) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(path)
    path.chmod(0o600)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bank", type=Path, default=DEFAULT_BANK)
    args = parser.parse_args()

    bank = args.bank.resolve()
    assignments = json.loads((bank / "assignments.json").read_text(encoding="utf-8"))
    if not isinstance(assignments, list) or not assignments:
        raise SystemExit(f"Invalid credential bank: {bank}")

    batch_order = {batch_id: index for index, batch_id in enumerate(BATCHES)}
    for test_key in TESTS:
        selected = [row for row in assignments if row.get("test") == test_key and not row.get("internal")]
        if not selected:
            raise SystemExit(f"No credentials found for {test_key}")
        if any(str(row.get("batch_id")) not in batch_order for row in selected):
            raise SystemExit(f"Unexpected batch in {test_key}")
        selected.sort(key=lambda row: (int(row["slot"]), batch_order[str(row["batch_id"])]))
        lines = [f"{row['username']},{row['password']}" for row in selected]
        if len(lines) != len(set(lines)):
            raise SystemExit(f"Duplicate credentials in {test_key}")
        private_write(bank / f"{test_key}.txt", "\n".join(lines) + "\n")

    readme_path = bank / "README.json"
    readme = json.loads(readme_path.read_text(encoding="utf-8"))
    readme["prolific_txt_order"] = "round-robin by slot, then set_01 through set_12"
    private_write(readme_path, json.dumps(readme, indent=2) + "\n")
    print(f"Reordered {len(TESTS)} Prolific credential files in {bank}")


if __name__ == "__main__":
    main()
