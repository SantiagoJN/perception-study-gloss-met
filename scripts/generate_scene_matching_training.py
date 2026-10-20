#!/usr/bin/env python3
"""Build the two fixed, non-recorded training examples for test 3."""

from __future__ import annotations

import csv
import json
from pathlib import Path

from PIL import Image


HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent
ROOT = PROJECT.parent
METADATA = ROOT / "mining_pairs_v2/tables/image_metadata_validated.csv"
MAPPING = PROJECT / "private/deployment/cloudflare_name_mapping.csv"
OUTPUT = PROJECT / "public/scene_matching_training.json"
THUMBNAILS = PROJECT / "public/scene_matching_thumbnails"

EXAMPLES = (
    {
        "training_id": "TRAINING_ILLUMINATION",
        "shared_factor": "illumination",
        "target_label": "A",
        "first_ids": ("img_2400", "img_2640", "img_2880", "img_3360"),
        "second_ids": ("img_2882", "img_3362", "img_2402", "img_2642"),
        "first_geometry": "sphere",
        "second_geometry": "sphere",
        "first_environment": "forest_cave",
        "second_environment": "chinese_garden",
    },
    {
        "training_id": "TRAINING_GEOMETRY",
        "shared_factor": "geometry",
        "target_label": "C",
        "first_ids": ("img_2418", "img_2658", "img_2898", "img_3378"),
        "second_ids": ("img_3396", "img_2916", "img_2676", "img_2436"),
        "first_geometry": "bumpiness_1",
        "second_geometry": "ridges_0",
        "first_environment": "forest_cave",
        "second_environment": "forest_cave",
    },
)
EXPECTED_GROUPS = {"G90", "G91", "G92", "G94"}


def read_csv(path: Path, key: str) -> dict[str, dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as stream:
        return {row[key]: row for row in csv.DictReader(stream)}


def main() -> None:
    images = read_csv(METADATA, "image_id")
    mapping = read_csv(MAPPING, "original_filename")
    THUMBNAILS.mkdir(parents=True, exist_ok=True)
    examples = []
    for spec in EXAMPLES:
        first_rows = [images[image_id] for image_id in spec["first_ids"]]
        second_rows = [images[image_id] for image_id in spec["second_ids"]]
        for rows, geometry, environment in (
            (first_rows, spec["first_geometry"], spec["first_environment"]),
            (second_rows, spec["second_geometry"], spec["second_environment"]),
        ):
            assert {row["group_id"] for row in rows} == EXPECTED_GROUPS
            assert {row["geometry_id"] for row in rows} == {geometry}
            assert {row["environment_id"] for row in rows} == {environment}
            assert all(row["material_type"] == "svbrdf_edit" for row in rows)
            assert all(row["gloss_level"] == "low" and row["metallic_level"] == "low" for row in rows)
        assert {row["material_id"] for row in first_rows} == {row["material_id"] for row in second_rows}
        target = first_rows["ABCD".index(spec["target_label"])]["material_id"]
        correct_option = next(index + 1 for index, row in enumerate(second_rows) if row["material_id"] == target)

        def record(row: dict[str, str]) -> dict[str, str]:
            original_name = Path(row["image_png"]).name
            source = ROOT / row["image_png"]
            destination = THUMBNAILS / f'{row["image_id"]}.webp'
            if not destination.is_file():
                with Image.open(source) as image:
                    image.convert("RGB").resize((384, 384), Image.Resampling.LANCZOS).save(
                        destination, "WEBP", quality=82, method=6
                    )
            return {
                "image_id": row["image_id"],
                "image_path": mapping[original_name]["cloudflare_object_filename"],
                "thumbnail_path": f'scene_matching_thumbnails/{row["image_id"]}.webp',
            }

        examples.append({
            "training_id": spec["training_id"],
            "shared_factor": spec["shared_factor"],
            "target_label": spec["target_label"],
            "correct_option": correct_option,
            "first_scene": [record(row) for row in first_rows],
            "second_scene": [record(row) for row in second_rows],
        })
    OUTPUT.write_text(json.dumps({"schema_version": 1, "examples": examples}, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(examples)} training examples and their thumbnails to {OUTPUT}")


if __name__ == "__main__":
    main()