#!/usr/bin/env python3
"""Remove sensitive fields from participant manifests before deployment.

The separate testing answer map remains public intentionally because the
GitHub Pages deployment exposes the explicitly approved ``/testing`` route.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def load_trials(path: Path) -> tuple[object, list[dict]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    trials = payload if isinstance(payload, list) else payload["trials"]
    return payload, trials


def write(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def strip_image_metadata(image: dict) -> None:
    for field in (
        "material_id",
        "group_id",
        "geometry_id",
        "illumination_id",
        "environment_id",
    ):
        image.pop(field, None)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("dist"))
    args = parser.parse_args()
    root = args.root.resolve()

    forced_path = root / "forced_choice_trials.json"
    forced_payload, forced_trials = load_trials(forced_path)
    for trial in forced_trials:
        trial.pop("correct_option", None)
        trial.pop("family_id", None)
        strip_image_metadata(trial["reference"])
        for option in trial.get("options", []):
            strip_image_metadata(option)
    write(forced_path, forced_payload)

    scene_path = root / "scene_matching_trials.json"
    scene_payload, scene_trials = load_trials(scene_path)
    for trial in scene_trials:
        trial.pop("correct_option", None)
        trial.pop("family_id", None)
        for image in [*trial.get("first_scene", []), *trial.get("second_scene", [])]:
            strip_image_metadata(image)
    write(scene_path, scene_payload)

    context_path = root / "context_matching2_trials.json"
    context_payload, context_trials = load_trials(context_path)
    for trial in context_trials:
        trial.pop("correct_option", None)
        trial.pop("family_id", None)
        trial.pop("source_test2_trial_id", None)
        for image in [*trial.get("first_scene", []), *trial.get("second_scene", [])]:
            strip_image_metadata(image)
    write(context_path, context_payload)

    selection_path = root / "selection_trials.json"
    selection_payload, selection_trials = load_trials(selection_path)
    for trial in selection_trials:
        trial.pop("positive_count", None)
        trial.pop("family_id", None)
        trial.pop("profile", None)
        strip_image_metadata(trial["reference"])
        for candidate in trial.get("candidates", []):
            candidate.pop("is_same_material", None)
            candidate.pop("role", None)
            candidate.pop("candidate_role", None)
            candidate.pop("difficulty_score", None)
            strip_image_metadata(candidate)
    write(selection_path, selection_payload)

    print(f"Sanitized participant artifacts in {root}")


if __name__ == "__main__":
    main()
