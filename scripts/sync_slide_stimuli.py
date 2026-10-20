#!/usr/bin/env python3
"""Publish the slide-defined datasetv9 selections to the user study."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "mining_pairs_v9" / "stimuli_v4_general_geometry"
PUBLIC = ROOT / "perception-study-gloss-met" / "public"
RENDERS3 = ROOT / "datasetv9" / "groups4" / "renders3"


def load(test: int) -> list[dict[str, Any]]:
    payload = json.loads((SOURCE / f"test{test}.json").read_text())
    return payload["setups"]


def write(path: Path, payload: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def clean_image(item: dict[str, Any]) -> dict[str, Any]:
    return {
        key: item[key]
        for key in (
            "image_id", "image_path", "material_id", "group_id",
            "geometry_id", "illumination_id",
        )
        if key in item
    }


def scene_paths(setup: dict[str, Any]) -> dict[str, dict[str, str]]:
    reference = setup["reference"]
    question = setup["options"][0]
    prefix = "datasetv9/groups4/renders3"
    return {
        "reference": {"image_path": (
            f"{prefix}/{setup['setup_id']}_reference_"
            f"[{reference['illumination_id']}]_[{reference['geometry_id']}].png"
        )},
        "question": {"image_path": (
            f"{prefix}/{setup['setup_id']}_question_"
            f"[{question['illumination_id']}]_[{question['geometry_id']}].png"
        )},
    }


def main() -> None:
    test1, test2, test3, test4 = (load(number) for number in range(1, 5))
    test3_browser = [{**setup, "scene_images": scene_paths(setup)} for setup in test3]
    missing_scenes = [
        scene["image_path"]
        for setup in test3_browser
        for scene in setup["scene_images"].values()
        if not (ROOT / scene["image_path"]).is_file()
    ]
    if missing_scenes:
        raise RuntimeError(
            f"Cannot publish: {len(missing_scenes)} rendered test-3 scenes are missing"
        )

    pairs = [{
        "pair_id": setup["setup_id"],
        "image_path_a": setup["image_a"]["image_path"],
        "image_path_b": setup["image_b"]["image_path"],
        "stratum": (
            f"{setup['physical_relation']}:{setup['difficulty_level']}"
        ),
        "difficulty_level": setup["difficulty_level"],
        "physical_type": setup["physical_relation"],
        "group_id": setup["group_id"],
    } for setup in test1]

    forced = {
        "schema_version": 3,
        "dataset": "datasetv9_slide_stimuli",
        "trials": [{
            "trial_id": setup["setup_id"],
            "family_id": setup["family_id"],
            "difficulty_level": setup["difficulty_level"],
            "reference": clean_image(setup["reference"]),
            "options": [clean_image(item) for item in setup["options"]],
            "correct_option": setup["correct_option"],
        } for setup in test2],
    }

    scene = {
        "schema_version": 3,
        "dataset": "datasetv9_general_reference_stimuli_groups4_renders3",
        "trials": [{
            "trial_id": setup["setup_id"],
            "family_id": setup["family_id"],
            "difficulty_level": setup["difficulty_level"],
            "shared_factor": setup["change_type"],
            "target_label": "R",
            "first_scene": [{
                "image_id": f"{setup['setup_id']}_reference",
                "image_path": setup["scene_images"]["reference"]["image_path"],
                "thumbnail_path": setup["scene_images"]["reference"]["image_path"],
                "group_id": setup["group_id"],
            }],
            "second_scene": [{
                "image_id": f"{setup['setup_id']}_question",
                "image_path": setup["scene_images"]["question"]["image_path"],
                "thumbnail_path": setup["scene_images"]["question"]["image_path"],
                "group_id": setup["group_id"],
            }],
            "correct_option": setup["correct_option"],
        } for setup in test3_browser],
    }

    selection = {
        "schema_version": 3,
        "dataset": "datasetv9_slide_stimuli",
        "candidate_count": 6,
        "maximum_matches_disclosed_to_participant": 2,
        "trials": [{
            "trial_id": setup["setup_id"],
            "family_id": setup["family_id"],
            "difficulty_level": setup["difficulty_level"],
            "reference_source_type": "datasetv9",
            "reference": clean_image(setup["reference"]),
            "candidates": [{
                **clean_image(item),
                "candidate_id": item["image_id"],
                "is_same_material": item["is_same_material"],
                "difficulty_score": item["candidate_difficulty"],
            } for item in setup["candidates"]],
            "positive_count": setup["positive_count"],
            "profile": "slide_test2_extension",
        } for setup in test4],
    }

    answers = {
        "pairs": {
            setup["setup_id"]: (
                5 if setup["physical_relation"] == "same_material" else 1
            ) for setup in test1
        },
        "forced_choices": {
            setup["setup_id"]: setup["correct_option"] for setup in test2
        },
        "scene_matches": {
            setup["setup_id"]: setup["correct_option"] for setup in test3
        },
        "selections": {
            setup["setup_id"]: [
                item["image_id"] for item in setup["candidates"]
                if item["is_same_material"]
            ] for setup in test4
        },
    }

    write(PUBLIC / "study_pairs.json", pairs)
    write(PUBLIC / "forced_choice_trials.json", forced)
    write(PUBLIC / "scene_matching_trials.json", scene)
    write(PUBLIC / "selection_trials.json", selection)
    write(PUBLIC / "testing_ground_truth.json", answers)
    browser = PUBLIC / "stimuli_tests" / "data"
    browser.mkdir(parents=True, exist_ok=True)
    for number, setups in (
        (1, test1), (2, test2), (3, test3_browser), (4, test4),
    ):
        write(browser / f"test{number}.json", {
            "schema_version": "datasetv9-stimuli-v4-general-reference-geometry",
            "test": number,
            "setups": setups,
        })
    print(json.dumps({
        "test1": len(pairs),
        "test2": len(forced["trials"]),
        "test3": len(scene["trials"]),
        "test4": len(selection["trials"]),
    }, indent=2))


if __name__ == "__main__":
    main()
