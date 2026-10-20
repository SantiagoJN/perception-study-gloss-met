#!/usr/bin/env python3
"""Build the private/audit manifest used by the Test #4 setup viewer."""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent
DEFAULT_PUBLIC = PROJECT / "public/selection_trials.json"
DEFAULT_GROUND_TRUTH = PROJECT / "stimulus_generation/selection_v1/selection_trials_ground_truth.csv"
DEFAULT_OUTPUT = PROJECT / "public/test4_setups/setups.json"
OPAQUE_NAME = re.compile(r"^[0-9a-f]{64}\.png$")


def parse_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes"}


def candidate_record(public: dict, private: dict) -> dict:
    return {
        "image_id": public["image_id"],
        "image_path": public["image_path"],
        "thumbnail_path": public["thumbnail_path"],
        "material_id": private["candidate_material_id"],
        "group_id": private["candidate_group_id"],
        "geometry_id": private["candidate_geometry_id"],
        "environment_id": private["candidate_environment_id"],
        "is_same_material": parse_bool(private["is_same_material"]),
        "candidate_role": private["candidate_role"],
        "difficulty_score": float(private["difficulty_score"]),
        "difficulty_band": private["difficulty_band"],
        "change_type": private["change_type"],
        "shortcut_any": parse_bool(private["shortcut_any"]),
        "score_material_appearance": float(private["score_material_appearance"]),
        "score_specular_gloss": float(private["score_specular_gloss"]),
        "score_dino_visual": float(private["score_dino_visual"]),
    }


def build(public_path: Path, ground_truth_path: Path) -> dict:
    public_data = json.loads(public_path.read_text(encoding="utf-8"))
    trials = public_data["trials"]
    with ground_truth_path.open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream))

    private_by_key = {(r["trial_id"], r["candidate_image_id"]): r for r in rows}
    rows_by_trial: dict[str, list[dict]] = {}
    for row in rows:
        rows_by_trial.setdefault(row["trial_id"], []).append(row)

    result = []
    match_counts = Counter()
    for trial in trials:
        trial_id = trial["trial_id"]
        audit_rows = rows_by_trial.get(trial_id, [])
        if len(audit_rows) != 18 or len(trial["candidates"]) != 18:
            raise ValueError(f"{trial_id}: expected 18 public and private candidates")

        reference = trial["reference"]
        first = audit_rows[0]
        if not OPAQUE_NAME.fullmatch(reference["image_path"]):
            raise ValueError(f"{trial_id}: reference path is not anonymized")

        candidates = []
        for item in trial["candidates"]:
            if not OPAQUE_NAME.fullmatch(item["image_path"]):
                raise ValueError(f"{trial_id}: candidate path is not anonymized")
            key = (trial_id, item["image_id"])
            if key not in private_by_key:
                raise ValueError(f"{trial_id}: missing audit row for {item['image_id']}")
            candidates.append(candidate_record(item, private_by_key[key]))

        candidate_ids = [item["image_id"] for item in candidates]
        if len(set(candidate_ids)) != 18:
            raise ValueError(f"{trial_id}: candidate images are not unique")
        if reference["image_id"] in candidate_ids:
            raise ValueError(f"{trial_id}: the reference is also a candidate")

        same = sorted(
            (item for item in candidates if item["is_same_material"]),
            key=lambda item: (item["difficulty_score"], item["image_id"]),
        )
        different = sorted(
            (item for item in candidates if not item["is_same_material"]),
            key=lambda item: (item["difficulty_score"], item["image_id"]),
        )
        roles = {item["candidate_role"] for item in candidates}
        expected_roles = {
            f"{prefix}_{level}"
            for prefix in ("positive", "distractor")
            for level in ("easy", "medium_easy", "medium_hard", "hard")
        }
        if roles != expected_roles:
            raise ValueError(f"{trial_id}: missing difficulty/material combinations: {roles}")
        if not 4 <= len(same) <= 5:
            raise ValueError(f"{trial_id}: expected 4--5 matches, found {len(same)}")
        if any(a["difficulty_score"] > b["difficulty_score"] for a, b in zip(same, same[1:])):
            raise ValueError(f"{trial_id}: same-material candidates are not sorted")
        if any(a["difficulty_score"] > b["difficulty_score"] for a, b in zip(different, different[1:])):
            raise ValueError(f"{trial_id}: different-material candidates are not sorted")

        match_counts[len(same)] += 1
        result.append({
            "trial_id": trial_id,
            "reference_source_type": trial["reference_source_type"],
            "reference": {
                **reference,
                "material_id": first["reference_material_id"],
                "group_id": first["reference_group_id"],
                "geometry_id": first["reference_geometry_id"],
                "environment_id": first["reference_environment_id"],
            },
            "same_material": same,
            "different_material": different,
        })

    if len(result) != 400:
        raise ValueError(f"expected 400 setups, found {len(result)}")
    if match_counts != Counter({4: 200, 5: 200}):
        raise ValueError(f"unexpected match-count balance: {dict(match_counts)}")

    return {
        "schema_version": 1,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_manifest": str(public_path.relative_to(PROJECT)),
        "source_ground_truth": str(ground_truth_path.relative_to(PROJECT)),
        "setup_count": len(result),
        "ordering": "Each material class is sorted left-to-right by ascending difficulty_score.",
        "match_count_distribution": dict(sorted(match_counts.items())),
        "setups": result,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-manifest", type=Path, default=DEFAULT_PUBLIC)
    parser.add_argument("--ground-truth", type=Path, default=DEFAULT_GROUND_TRUTH)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    payload = build(args.public_manifest.resolve(), args.ground_truth.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {payload['setup_count']} setups to {args.output}")
    print(f"Same-material counts: {payload['match_count_distribution']}")


if __name__ == "__main__":
    main()
