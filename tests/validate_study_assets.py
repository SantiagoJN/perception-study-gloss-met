#!/usr/bin/env python3
"""Validate the published trial manifests and every referenced image."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

from PIL import Image


PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT.parent
PUBLIC = PROJECT / "public"
LEVELS = {"easy", "medium_easy", "medium_hard", "hard"}
SOURCE = ROOT / "mining_pairs_v9/stimuli_v4_general_geometry"


def load(name: str) -> Any:
    return json.loads((PUBLIC / name).read_text(encoding="utf-8"))


def resolve_image(relative: str) -> Path:
    if relative.startswith("datasetv9/renders/"):
        render_root = next(
            path
            for path in (ROOT / "datasetv9/renders_testing", ROOT / "datasetv9/renders")
            if path.is_dir()
        )
        prefix = "datasetv9/renders/"
        return render_root / relative[len(prefix):]
    if relative.startswith("datasetv9/groups4/"):
        return ROOT / relative
    return PUBLIC / relative


def resolve_thumbnail(relative: str) -> tuple[Path, tuple[int, int]] | None:
    suffix = Path(relative).with_suffix(".webp").name
    if relative.startswith("datasetv9/renders/"):
        return ROOT / "datasetv9/thumbnails" / suffix, (512, 512)
    if relative.startswith("datasetv9/groups4/renders3/"):
        expected = (768, 256) if "_reference_" in relative else (1152, 256)
        return ROOT / "datasetv9/groups4/thumbnails" / suffix, expected
    if relative.startswith("datasetv9/groups4/sentinels/"):
        expected = (768, 256) if "[reference]" in relative else (1152, 256)
        return ROOT / "datasetv9/groups4/sentinels_thumbnails" / suffix, expected
    return None


def assert_unique(items: Iterable[str], label: str) -> None:
    values = list(items)
    assert len(values) == len(set(values)), f"Duplicate {label}"


def render_fields(path: str) -> tuple[str, str, str, str]:
    fields = re.findall(r"\[([^]]+)\]", Path(path).name)
    assert len(fields) == 5, f"Unexpected render name: {path}"
    illumination, geometry, group, edit, _ = fields
    return illumination, geometry, group, edit.split("_", 1)[0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--skip-local-assets",
        action="store_true",
        help="Validate committed manifests without requiring the external dataset checkout.",
    )
    args = parser.parse_args()

    pairs = load("study_pairs.json")
    forced = load("forced_choice_trials.json")["trials"]
    scenes = load("scene_matching_trials.json")["trials"]
    training = load("scene_matching_training.json")["examples"]
    selections = load("selection_trials.json")["trials"]
    sentinels = load("sentinel_trials.json")
    answers = load("testing_ground_truth.json")

    assert [len(pairs), len(forced), len(scenes), len(training), len(selections)] == [600, 600, 600, 4, 600]
    assert_unique((item["pair_id"] for item in pairs), "pair IDs")
    assert_unique((item["trial_id"] for item in forced), "forced-choice IDs")
    assert_unique((item["trial_id"] for item in scenes), "scene IDs")
    assert_unique((item["training_id"] for item in training), "scene-training IDs")
    assert_unique((item["trial_id"] for item in selections), "selection IDs")
    assert sentinels["positions"] == [2, 4, 8, 12, 15]
    worker_source = (PROJECT / "cloudflare-worker/src/index.js").read_text(encoding="utf-8")
    worker_version = re.search(r"SENTINEL_SCREENING_VERSION = '([^']+)'", worker_source)
    assert worker_version, "Worker sentinel-screening version is missing"
    assert sentinels.get("screening_version") == worker_version.group(1), (
        "The public sentinel manifest and Worker answer key are out of sync"
    )
    assert set(sentinels["tests"]) == {"test1", "test2", "test3", "test4"}
    assert all(len(items) == 5 for items in sentinels["tests"].values())
    assert_unique(
        (item["sentinel_id"] for items in sentinels["tests"].values() for item in items),
        "sentinel IDs",
    )

    pair_cells = Counter((item["difficulty_level"], item["physical_type"]) for item in pairs)
    assert {level for level, _ in pair_cells} == LEVELS
    for level in LEVELS:
        assert pair_cells[level, "same_material"] == 75
        assert pair_cells[level, "different_material"] == 75
    for item in pairs:
        fields_a = render_fields(item["image_path_a"])
        fields_b = render_fields(item["image_path_b"])
        assert fields_a[2] == fields_b[2] == item["group_id"]
        same_edit = fields_a[3] == fields_b[3]
        assert same_edit == (item["physical_type"] == "same_material")

    forced_levels = Counter(item["difficulty_level"] for item in forced)
    forced_sides = Counter(item["correct_option"] for item in forced)
    forced_cells = Counter((item["difficulty_level"], item["correct_option"]) for item in forced)
    assert forced_levels == Counter({level: 150 for level in LEVELS})
    assert forced_sides == Counter({"A": 300, "B": 300})
    assert forced_cells == Counter({(level, side): 75 for level in LEVELS for side in ("A", "B")})
    for item in forced:
        reference = item["reference"]
        options = item["options"]
        assert len(options) == 2
        assert all(option["group_id"] == reference["group_id"] for option in options)
        assert all(option["image_id"] != reference["image_id"] for option in options)
        ref_fields = render_fields(reference["image_path"])
        assert (ref_fields[0], ref_fields[1], ref_fields[2]) == (reference["illumination_id"], reference["geometry_id"], reference["group_id"])
        assert all(render_fields(option["image_path"])[2] == option["group_id"] for option in options)
        matches = [index for index, option in enumerate(options) if option["material_id"] == reference["material_id"]]
        assert matches == [0 if item["correct_option"] == "A" else 1]

    scene_levels = Counter(item["difficulty_level"] for item in scenes)
    scene_changes = Counter(item["shared_factor"] for item in scenes)
    assert scene_levels == Counter({level: 150 for level in LEVELS})
    assert scene_changes == Counter({"geometry": 300, "illumination": 300})
    for item in scenes:
        assert item["target_label"] == "R"
        assert len(item["first_scene"]) == len(item["second_scene"]) == 1
        assert item["correct_option"] in (1, 2, 3)
        assert item["first_scene"][0]["group_id"] == item["second_scene"][0]["group_id"]
    for item in training:
        assert item["target_label"] == "R"
        assert len(item["first_scene"]) == len(item["second_scene"]) == 1
        assert item["correct_option"] in (1, 2, 3)

    if not args.skip_local_assets:
        source_scenes = json.loads((SOURCE / "test3.json").read_text(encoding="utf-8"))["setups"]
        assert [item["setup_id"] for item in source_scenes] == [item["trial_id"] for item in scenes]
        for item in source_scenes:
            reference = item["reference"]
            options = item["options"]
            assert len(options) == 3
            assert all(option["group_id"] == reference["group_id"] for option in options)
            assert all(option["image_id"] != reference["image_id"] for option in options)
            matches = [index + 1 for index, option in enumerate(options) if option["material_id"] == reference["material_id"]]
            assert matches == [item["correct_option"]]
            if item["change_type"] == "illumination":
                assert all(option["geometry_id"] == reference["geometry_id"] for option in options)
                assert len({option["illumination_id"] for option in options}) == 1
                assert options[0]["illumination_id"] != reference["illumination_id"]
            else:
                assert item["change_type"] == "geometry"
                assert all(option["illumination_id"] == reference["illumination_id"] for option in options)
                assert len({option["geometry_id"] for option in options}) == 1
                assert options[0]["geometry_id"] != reference["geometry_id"]

    selection_levels = Counter(item["difficulty_level"] for item in selections)
    selection_positives = Counter(item["positive_count"] for item in selections)
    assert selection_levels == Counter({level: 150 for level in LEVELS})
    assert selection_positives == Counter({1: 300, 2: 300})
    for item in selections:
        reference = item["reference"]
        candidates = item["candidates"]
        assert len(candidates) == 6
        assert_unique((candidate["candidate_id"] for candidate in candidates), f"candidate IDs in {item['trial_id']}")
        assert all(candidate["group_id"] == reference["group_id"] for candidate in candidates)
        assert all(candidate["image_id"] != reference["image_id"] for candidate in candidates)
        assert render_fields(reference["image_path"])[2] == reference["group_id"]
        assert all(render_fields(candidate["image_path"])[2] == candidate["group_id"] for candidate in candidates)
        positives = [candidate for candidate in candidates if candidate["is_same_material"]]
        assert len(positives) == item["positive_count"]
        assert all(candidate["material_id"] == reference["material_id"] for candidate in positives)
        assert all(candidate["material_id"] != reference["material_id"] for candidate in candidates if not candidate["is_same_material"])

    assert set(answers["pairs"]) == {item["pair_id"] for item in pairs}
    assert set(answers["forced_choices"]) == {item["trial_id"] for item in forced}
    assert set(answers["scene_matches"]) == {item["trial_id"] for item in scenes}
    assert set(answers["selections"]) == {item["trial_id"] for item in selections}

    image_paths = set()
    for item in pairs:
        image_paths.update((item["image_path_a"], item["image_path_b"]))
    for item in forced:
        image_paths.add(item["reference"]["image_path"])
        image_paths.update(option["image_path"] for option in item["options"])
    for item in [*scenes, *training]:
        image_paths.update(image["image_path"] for image in [*item["first_scene"], *item["second_scene"]])
    for item in selections:
        image_paths.add(item["reference"]["image_path"])
        image_paths.update(candidate["image_path"] for candidate in item["candidates"])
    for item in sentinels["tests"]["test1"]:
        image_paths.update((item["image_a"], item["image_b"]))
    for item in sentinels["tests"]["test2"]:
        image_paths.update((item["reference"], item["solution"], item["confounder"]))
    for item in sentinels["tests"]["test3"]:
        image_paths.update((item["reference_scene"], item["question_scene"]))
    for item in sentinels["tests"]["test4"]:
        image_paths.add(item["reference"])
        image_paths.update(candidate["image_path"] for candidate in item["candidates"])

    dimensions = Counter()
    thumbnail_dimensions = Counter()
    if not args.skip_local_assets:
        for relative in sorted(image_paths):
            path = resolve_image(relative)
            assert path.is_file(), f"Missing image: {relative} -> {path}"
            with Image.open(path) as image:
                dimensions[image.size] += 1
                image.verify()
            thumbnail = resolve_thumbnail(relative)
            if thumbnail is not None:
                thumbnail_path, expected_size = thumbnail
                assert thumbnail_path.is_file(), f"Missing thumbnail: {relative} -> {thumbnail_path}"
                with Image.open(thumbnail_path) as image:
                    assert image.size == expected_size, (
                        f"Unexpected thumbnail dimensions for {thumbnail_path}: "
                        f"{image.size} != {expected_size}"
                    )
                    thumbnail_dimensions[image.size] += 1
                    image.verify()

    print(json.dumps({
        "pairs": len(pairs),
        "forced_choices": len(forced),
        "scene_matches": len(scenes),
        "scene_training": len(training),
        "selections": len(selections),
        "unique_image_references": len(image_paths),
        "local_images_verified": not args.skip_local_assets,
        "image_dimensions": {f"{width}x{height}": count for (width, height), count in dimensions.items()},
        "thumbnail_dimensions": {f"{width}x{height}": count for (width, height), count in thumbnail_dimensions.items()},
        "selection_positive_counts": dict(sorted(selection_positives.items())),
        "sentinel_positions": sentinels["positions"],
        "sentinels_per_test": {
            name: len(items) for name, items in sentinels["tests"].items()
        },
    }, indent=2))


if __name__ == "__main__":
    main()
