#!/usr/bin/env python3
"""Validate and publish the fixed sentinel configuration for all four tests."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from PIL import Image


PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT.parent
SOURCE = PROJECT / "stimulus_generation" / "sentinels" / "config.json"
OUTPUT = PROJECT / "public" / "sentinel_trials.json"
POSITIONS = [2, 4, 8, 12, 15]


def resolve(path: str) -> Path:
    if path.startswith("datasetv9/renders/"):
        basename = path[len("datasetv9/renders/"):]
        for directory in (ROOT / "datasetv9/renders_testing", ROOT / "datasetv9/renders"):
            candidate = directory / basename
            if candidate.is_file():
                return candidate
        return ROOT / path
    return ROOT / path


def fields(path: str) -> tuple[str, str, str, str, str]:
    values = re.findall(r"\[([^]]+)\]", Path(path).name)
    if len(values) != 5:
        raise ValueError(f"Unexpected dataset render name: {path}")
    illumination, geometry, group, edit_label, material = values
    return illumination, geometry, group, edit_label[:2], material


def assert_image(path: str) -> None:
    target = resolve(path)
    if not target.is_file():
        raise FileNotFoundError(f"Missing sentinel image: {path} -> {target}")
    with Image.open(target) as image:
        image.verify()


def validate(payload: dict[str, Any]) -> None:
    if payload.get("positions") != POSITIONS:
        raise ValueError(f"Sentinel positions must be {POSITIONS}")
    tests = payload.get("tests", {})
    if set(tests) != {"test1", "test2", "test3", "test4"}:
        raise ValueError("Sentinel configuration must define tests 1--4")
    for name, setups in tests.items():
        if len(setups) != 5:
            raise ValueError(f"{name} must contain exactly five sentinels")
        ids = [setup["sentinel_id"] for setup in setups]
        if len(ids) != len(set(ids)):
            raise ValueError(f"Duplicate sentinel IDs in {name}")

    for setup in tests["test1"]:
        assert_image(setup["image_a"])
        assert_image(setup["image_b"])
        same = fields(setup["image_a"])[2:4] == fields(setup["image_b"])[2:4]
        expected = setup["physical_relation"] == "same_material"
        if same != expected:
            raise ValueError(f"Incorrect physical relation in {setup['sentinel_id']}")

    for setup in tests["test2"]:
        for key in ("reference", "solution", "confounder"):
            assert_image(setup[key])
        reference = fields(setup["reference"])
        solution = fields(setup["solution"])
        confounder = fields(setup["confounder"])
        if reference[2:4] != solution[2:4] or reference[2:4] == confounder[2:4]:
            raise ValueError(f"Invalid solution/confounder in {setup['sentinel_id']}")
        if setup["correct_option"] not in {"A", "B"}:
            raise ValueError(f"Invalid correct option in {setup['sentinel_id']}")

    for setup in tests["test3"]:
        assert_image(setup["reference_scene"])
        assert_image(setup["question_scene"])
        if setup["shared_factor"] not in {"geometry", "illumination"}:
            raise ValueError(f"Invalid shared factor in {setup['sentinel_id']}")
        if setup["correct_option"] not in {1, 2, 3}:
            raise ValueError(f"Invalid correct option in {setup['sentinel_id']}")

    for setup in tests["test4"]:
        assert_image(setup["reference"])
        candidates = setup["candidates"]
        if len(candidates) != 6:
            raise ValueError(f"{setup['sentinel_id']} must contain six candidates")
        paths = [candidate["image_path"] for candidate in candidates]
        if len(paths) != len(set(paths)):
            raise ValueError(f"Duplicate candidates in {setup['sentinel_id']}")
        for path in paths:
            assert_image(path)
        positive_count = sum(candidate["role"] == "solution" for candidate in candidates)
        if positive_count not in {1, 2}:
            raise ValueError(f"Invalid positive count in {setup['sentinel_id']}")
        reference = fields(setup["reference"])
        for candidate in candidates:
            candidate_fields = fields(candidate["image_path"])
            same = reference[2:4] == candidate_fields[2:4]
            if same != (candidate["role"] == "solution"):
                raise ValueError(f"Invalid candidate role in {setup['sentinel_id']}")


def main() -> None:
    payload = json.loads(SOURCE.read_text(encoding="utf-8"))
    validate(payload)
    temporary = OUTPUT.with_suffix(".json.part")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(OUTPUT)
    print(json.dumps({
        "output": str(OUTPUT),
        "positions": payload["positions"],
        "counts": {name: len(rows) for name, rows in payload["tests"].items()},
    }, indent=2))


if __name__ == "__main__":
    main()
