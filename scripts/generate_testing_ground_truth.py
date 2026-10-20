#!/usr/bin/env python3
"""Regenerate /testing answers from the exact final trial manifests."""

from __future__ import annotations

import csv
import json
import os
from pathlib import Path


PROJECT = Path(__file__).resolve().parent.parent
ROOT = PROJECT.parent
PUBLIC = PROJECT / "public"
NEW_TASKS = PROJECT / "stimulus_generation/new_tasks_v1"
SELECTION = PROJECT / "stimulus_generation/selection_v1"
PAIR_AUDIT = ROOT / "mining_pairs_v2/selection/pairs_selected.csv"


def rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as stream:
        return list(csv.DictReader(stream))


def manifest_ids(path: Path, key: str) -> set[str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    entries = payload["trials"] if isinstance(payload, dict) else payload
    return {str(entry[key]) for entry in entries}


def atomic_json(path: Path, payload: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def main() -> None:
    pairs = {
        row["pair_id"]: 5 if row["physical_type"] == "same_material" else 1
        for row in rows(PAIR_AUDIT)
        if row["status"] == "selected_for_pilot"
    }

    forced: dict[str, str] = {}
    for row in rows(NEW_TASKS / "forced_choice_ground_truth.csv"):
        if row["is_same_material"].lower() == "true":
            forced[row["trial_id"]] = row["option"]

    scenes = {
        row["trial_id"]: int(row["correct_option"])
        for row in rows(NEW_TASKS / "scene_matching_ground_truth.csv")
    }

    selections: dict[str, list[str]] = {}
    for row in rows(SELECTION / "selection_trials_ground_truth.csv"):
        if row["is_same_material"].lower() == "true":
            selections.setdefault(row["trial_id"], []).append(row["candidate_image_id"])
    selections = {key: sorted(values) for key, values in selections.items()}

    expected = {
        "pairs": manifest_ids(PUBLIC / "study_pairs.json", "pair_id"),
        "forced_choices": manifest_ids(PUBLIC / "forced_choice_trials.json", "trial_id"),
        "scene_matches": manifest_ids(PUBLIC / "scene_matching_trials.json", "trial_id"),
        "selections": manifest_ids(PUBLIC / "selection_trials.json", "trial_id"),
    }
    payload = {
        "pairs": pairs,
        "forced_choices": forced,
        "scene_matches": scenes,
        "selections": selections,
    }
    for name, identifiers in expected.items():
        actual = set(payload[name])
        if actual != identifiers:
            raise RuntimeError(
                f"{name}: testing answers do not match final manifest "
                f"(missing={len(identifiers - actual)}, extra={len(actual - identifiers)})"
            )
    if any(not 4 <= len(matches) <= 5 for matches in selections.values()):
        raise RuntimeError("Test #4 answers must contain four or five matching candidates.")

    output = PUBLIC / "testing_ground_truth.json"
    atomic_json(output, payload)
    print("Wrote final-manifest testing answers:")
    for name, values in payload.items():
        print(f"  {name}: {len(values)}")


if __name__ == "__main__":
    main()
