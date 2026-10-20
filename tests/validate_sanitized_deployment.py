#!/usr/bin/env python3
"""Validate the exact static artifact that is about to be published."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


SENSITIVE_IMAGE_FIELDS = {
    "material_id",
    "group_id",
    "geometry_id",
    "illumination_id",
    "environment_id",
}


def trials(root: Path, filename: str) -> list[dict]:
    payload = json.loads((root / filename).read_text(encoding="utf-8"))
    return payload if isinstance(payload, list) else payload["trials"]


def assert_clean_image(image: dict, location: str) -> None:
    leaked = SENSITIVE_IMAGE_FIELDS.intersection(image)
    assert not leaked, f"Sensitive image metadata in {location}: {sorted(leaked)}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("dist"))
    args = parser.parse_args()
    root = args.root.resolve()

    config = (root / "config.js").read_text(encoding="utf-8")
    lowered = config.lower()
    assert "supabase" not in lowered, "Legacy Supabase configuration is public"
    assert "r2.dev" not in lowered, "Production artifact still uses r2.dev"
    assert re.search(r"stimulusBaseUrl[^\n]+https://", config), "Production stimulus URL is missing"
    assert not (root / "testing_ground_truth.json").exists(), "Testing answer key is public"

    for trial in trials(root, "forced_choice_trials.json"):
        assert "correct_option" not in trial
        assert_clean_image(trial["reference"], trial["trial_id"])
        for image in trial["options"]:
            assert_clean_image(image, trial["trial_id"])

    for trial in trials(root, "scene_matching_trials.json"):
        assert "correct_option" not in trial
        for image in [*trial["first_scene"], *trial["second_scene"]]:
            assert_clean_image(image, trial["trial_id"])

    for trial in trials(root, "selection_trials.json"):
        assert "positive_count" not in trial
        assert "profile" not in trial
        assert_clean_image(trial["reference"], trial["trial_id"])
        for candidate in trial["candidates"]:
            assert "is_same_material" not in candidate
            assert "role" not in candidate
            assert "candidate_role" not in candidate
            assert "difficulty_score" not in candidate
            assert_clean_image(candidate, trial["trial_id"])

    print("Sanitized deployment valid: no public answer keys, image metadata, Supabase config, or r2.dev origin.")


if __name__ == "__main__":
    main()
