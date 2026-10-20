#!/usr/bin/env python3
"""Generate reproducible manifests for the 2AFC and four-material tasks.

The public JSON files contain no material identities or correct answers. Those
remain in private CSV audit tables so responses can be joined by ``trial_id``.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
from pathlib import Path

import pandas as pd
from PIL import Image


HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent
ROOT = PROJECT.parent
METADATA = ROOT / "mining_pairs_v2/tables/image_metadata_validated.parquet"
CANDIDATES = ROOT / "mining_pairs_v2/candidates/candidate_pool.parquet"
MAPPING = PROJECT / "private/deployment/cloudflare_name_mapping.csv"
PUBLIC = PROJECT / "public"
AUDIT = PROJECT / "stimulus_generation/new_tasks_v1"
THUMBNAILS = PUBLIC / "scene_matching_thumbnails"
SEED = 20260929
TRIALS = 120
DIFFICULTY_LEVELS = ("easy", "medium_easy", "medium_hard", "hard")
OPTION_CONTEXT_RELATIONS = ("same_scene", "geometry_only", "illumination_only", "geometry_and_illumination")
DIFFICULTY_TARGET_QUANTILES = {
    "easy": 0.90,
    "medium_easy": 0.65,
    "medium_hard": 0.35,
    "hard": 0.05,
}
GEOMETRIES = ["sphere", "blob", "bumpiness_0", "bumpiness_1", "bumpiness_2",
              "bumpiness_3", "ridges_0", "ridges_1", "ridges_2", "ridges_3"]
ENVIRONMENTS = ["forest_cave", "machine_shop", "chinese_garden", "canary_wharf",
                "small_cathedral", "christmas_photo_studio"]


def load_inputs() -> tuple[pd.DataFrame, pd.DataFrame, dict[str, str]]:
    images = pd.read_parquet(METADATA)[[
        "image_id", "image_png", "material_id", "material_type", "group_id",
        "geometry_id", "environment_id",
    ]].copy()
    if len(images) != 3600 or images.image_id.nunique() != 3600:
        raise RuntimeError("Expected the validated 3,600-image datasetv7 table")
    with MAPPING.open(newline="", encoding="utf-8") as stream:
        mapping = {
            row["original_filename"]: row["cloudflare_object_filename"]
            for row in csv.DictReader(stream)
        }
    missing = sorted({Path(path).name for path in images.image_png} - mapping.keys())
    if missing:
        raise RuntimeError(f"Anonymous mapping is missing {len(missing)} renders")
    images["public_path"] = images.image_png.map(lambda path: mapping[Path(path).name])
    pairs = pd.read_parquet(CANDIDATES, columns=[
        "image_id_a", "image_id_b", "image_path_a", "image_path_b",
        "material_a", "material_b", "group_a", "group_b", "geometry_a",
        "geometry_b", "environment_a", "environment_b", "physical_type",
        "difficulty_score", "score_material_appearance", "score_specular_gloss",
        "score_dino_visual", "shortcut_any", "pair_qc_valid",
        "pair_selection_eligible",
    ])
    pairs = pairs[
        pairs.pair_qc_valid.astype(bool)
        & pairs.pair_selection_eligible.astype(bool)
    ].copy()
    return images, pairs, mapping


def record(row: pd.Series, thumbnail: bool = False) -> dict[str, str]:
    value = {"image_id": row.image_id, "image_path": row.public_path}
    if thumbnail:
        value["thumbnail_path"] = f"scene_matching_thumbnails/{row.image_id}.webp"
    return value


def one(images: pd.DataFrame, material: str, geometry: str, environment: str) -> pd.Series:
    rows = images[
        (images.material_id == material)
        & (images.geometry_id == geometry)
        & (images.environment_id == environment)
    ]
    if len(rows) != 1:
        raise RuntimeError(f"Expected one render for {material}/{geometry}/{environment}, found {len(rows)}")
    return rows.iloc[0]


def choose_forced_references(images: pd.DataFrame, randomizer: random.Random) -> list[pd.Series]:
    """Select two unique, context-balanced references for every material."""
    selected: list[pd.Series] = []
    used_ids: set[str] = set()
    context_use: dict[tuple[str, str], int] = {}
    materials = sorted(images.material_id.unique())
    for _ in range(2):
        for material in materials:
            options = images[(images.material_id == material) & ~images.image_id.isin(used_ids)].copy()
            options["cost"] = [
                context_use.get((str(g), str(e)), 0) + randomizer.random() * 0.01
                for g, e in zip(options.geometry_id, options.environment_id)
            ]
            row = options.sort_values(["cost", "image_id"]).iloc[0]
            selected.append(row)
            used_ids.add(str(row.image_id))
            key = (str(row.geometry_id), str(row.environment_id))
            context_use[key] = context_use.get(key, 0) + 1
    return selected


def orient_for_references(pairs: pd.DataFrame, reference_ids: set[str]) -> dict[str, pd.DataFrame]:
    """Return pair descriptors oriented from each selected reference."""
    common = [
        "physical_type", "difficulty_score", "score_material_appearance",
        "score_specular_gloss", "score_dino_visual", "shortcut_any",
    ]
    left = pairs[pairs.image_id_a.astype(str).isin(reference_ids)][common + [
        "image_id_a", "image_id_b", "image_path_b", "material_b", "group_b",
        "geometry_b", "environment_b",
    ]].rename(columns={
        "image_id_a": "reference_id", "image_id_b": "image_id",
        "image_path_b": "image_path", "material_b": "material_id",
        "group_b": "group_id", "geometry_b": "geometry_id",
        "environment_b": "environment_id",
    })
    right = pairs[pairs.image_id_b.astype(str).isin(reference_ids)][common + [
        "image_id_b", "image_id_a", "image_path_a", "material_a", "group_a",
        "geometry_a", "environment_a",
    ]].rename(columns={
        "image_id_b": "reference_id", "image_id_a": "image_id",
        "image_path_a": "image_path", "material_a": "material_id",
        "group_a": "group_id", "geometry_a": "geometry_id",
        "environment_a": "environment_id",
    })
    oriented = pd.concat([left, right], ignore_index=True).drop_duplicates([
        "reference_id", "image_id",
    ])
    return {
        str(reference_id): frame.reset_index(drop=True)
        for reference_id, frame in oriented.groupby("reference_id", sort=False)
    }


def forced_triplet_pool(reference: pd.Series, candidates: pd.DataFrame) -> pd.DataFrame:
    """Pair a same-material option and within-group distractor in arbitrary scenes."""
    different_scene = (
        (
            (candidates.geometry_id.astype(str) != str(reference.geometry_id))
            | (candidates.environment_id.astype(str) != str(reference.environment_id))
        )
        & (candidates.image_id.astype(str) != str(reference.image_id))
    )
    candidates = candidates[different_scene].copy()
    positives = candidates[candidates.physical_type == "same_material"]
    negatives = candidates[
        (candidates.physical_type == "different_material")
        & (candidates.group_id.astype(str) == str(reference.group_id))
    ]
    positives = positives.assign(_cross_key=1)
    negatives = negatives.assign(_cross_key=1)
    merged = positives.merge(
        negatives,
        on="_cross_key",
        suffixes=("_match", "_different"),
        validate="many_to_many",
    ).drop(columns="_cross_key")
    same_geometry = merged.geometry_id_match.astype(str) == merged.geometry_id_different.astype(str)
    same_environment = merged.environment_id_match.astype(str) == merged.environment_id_different.astype(str)
    merged["options_context_relation"] = "geometry_and_illumination"
    merged.loc[same_geometry & same_environment, "options_context_relation"] = "same_scene"
    merged.loc[~same_geometry & same_environment, "options_context_relation"] = "geometry_only"
    merged.loc[same_geometry & ~same_environment, "options_context_relation"] = "illumination_only"
    merged["appearance_gap"] = (
        merged.score_material_appearance_different
        - merged.score_material_appearance_match
    )
    # A negative gap means the physically matching option is actually farther
    # according to the primary appearance descriptor. Those reversal cases are
    # interesting scientifically, but are not suitable for ordered difficulty
    # strata whose hard endpoint is intended to mean equal apparent distance.
    merged = merged[merged.appearance_gap >= 0].copy()
    if merged.empty:
        raise RuntimeError(f"No non-reversed triplet exists for {reference.image_id}")
    merged["gap_percentile"] = merged.appearance_gap.rank(method="average", pct=True)
    merged["triplet_difficulty_score"] = 1.0 - merged.gap_percentile
    return merged


def generate_forced_choice(images: pd.DataFrame, pairs: pd.DataFrame, randomizer: random.Random) -> None:
    public_trials: list[dict] = []
    private_rows: list[dict] = []
    eligible_ids = set(pairs.image_id_a.astype(str)) | set(pairs.image_id_b.astype(str))
    references = choose_forced_references(
        images[images.image_id.astype(str).isin(eligible_ids)].copy(), randomizer,
    )
    oriented = orient_for_references(pairs, {str(row.image_id) for row in references})
    option_use: dict[str, int] = {}
    relation_plan = list(OPTION_CONTEXT_RELATIONS) * (TRIALS // len(OPTION_CONTEXT_RELATIONS))
    random.Random(SEED + 17).shuffle(relation_plan)
    for reference_index, reference in enumerate(references):
        material_occurrence = reference_index // 60
        material_position = reference_index % 60
        level = DIFFICULTY_LEVELS[(material_position + 2 * material_occurrence) % 4]
        pool = forced_triplet_pool(reference, oriented[str(reference.image_id)])
        desired_relation = relation_plan[reference_index]
        relation_pool = pool[pool.options_context_relation == desired_relation]
        if relation_pool.empty:
            raise RuntimeError(
                f"No forced-choice triplet for {reference.image_id} with option relation {desired_relation}"
            )
        pool = relation_pool.copy()
        target = DIFFICULTY_TARGET_QUANTILES[level]
        pool["cost"] = (
            (pool.gap_percentile - target).abs()
            + pool.image_id_match.astype(str).map(option_use).fillna(0) * 0.02
            + pool.image_id_different.astype(str).map(option_use).fillna(0) * 0.02
            + (pool.shortcut_any_match.fillna(False).astype(bool)
               | pool.shortcut_any_different.fillna(False).astype(bool)).astype(float) * 0.04
        )
        row = pool.sort_values(["cost", "appearance_gap", "image_id_match", "image_id_different"]).iloc[0]
        positive = images.loc[images.image_id == row.image_id_match].iloc[0]
        negative = images.loc[images.image_id == row.image_id_different].iloc[0]
        option_use[str(positive.image_id)] = option_use.get(str(positive.image_id), 0) + 1
        option_use[str(negative.image_id)] = option_use.get(str(negative.image_id), 0) + 1
        options = [(positive, True), (negative, False)]
        randomizer.shuffle(options)
        trial_id = f"FORCED_{len(public_trials) + 1:04d}"
        public_trials.append({
            "trial_id": trial_id,
            "difficulty_level": level,
            "reference": record(reference),
            "options": [record(option) for option, _ in options],
        })
        for position, (option, is_match) in enumerate(options):
            suffix = "match" if is_match else "different"
            private_rows.append({
                "trial_id": trial_id,
                "difficulty_level": level,
                "triplet_difficulty_score": float(row.triplet_difficulty_score),
                "appearance_gap_different_minus_match": float(row.appearance_gap),
                "options_context_relation": row.options_context_relation,
                "match_appearance_distance": float(row.score_material_appearance_match),
                "different_appearance_distance": float(row.score_material_appearance_different),
                "match_specular_gloss_distance": float(row.score_specular_gloss_match),
                "different_specular_gloss_distance": float(row.score_specular_gloss_different),
                "match_dino_distance": float(row.score_dino_visual_match),
                "different_dino_distance": float(row.score_dino_visual_different),
                "option": "AB"[position],
                "is_same_material": is_match,
                "reference_image_id": reference.image_id,
                "reference_material_id": reference.material_id,
                "reference_group_id": reference.group_id,
                "reference_geometry_id": reference.geometry_id,
                "reference_environment_id": reference.environment_id,
                "option_image_id": option.image_id,
                "option_material_id": option.material_id,
                "option_geometry_id": option.geometry_id,
                "option_environment_id": option.environment_id,
                "option_appearance_distance": float(row[f"score_material_appearance_{suffix}"]),
            })
    if len(public_trials) != TRIALS:
        raise RuntimeError(f"Expected {TRIALS} forced-choice trials, found {len(public_trials)}")
    (PUBLIC / "forced_choice_trials.json").write_text(
        json.dumps({"schema_version": 1, "seed": SEED, "trials": public_trials}, separators=(",", ":")),
        encoding="utf-8",
    )
    pd.DataFrame(private_rows).to_csv(AUDIT / "forced_choice_ground_truth.csv", index=False)


def make_thumbnail(row: pd.Series) -> None:
    output = THUMBNAILS / f"{row.image_id}.webp"
    if output.is_file():
        return
    source = ROOT / row.image_png
    with Image.open(source) as image:
        image.convert("RGB").resize((384, 384), Image.Resampling.LANCZOS).save(
            output, "WEBP", quality=82, method=6,
        )


def generate_scene_matching(images: pd.DataFrame, randomizer: random.Random) -> None:
    public_trials: list[dict] = []
    private_rows: list[dict] = []
    groups = {
        group: sorted(frame.material_id.unique().tolist())
        for group, frame in images.groupby("group_id", sort=True)
    }
    invalid = {group: values for group, values in groups.items() if len(values) != 4}
    if invalid:
        raise RuntimeError(f"Every curated group must contain four materials: {invalid}")
    for repetition in range(8):
        for group_id, materials in groups.items():
            shared_factor = "illumination" if len(public_trials) % 2 == 0 else "geometry"
            first_order = list(materials)
            second_order = list(materials)
            randomizer.shuffle(first_order)
            randomizer.shuffle(second_order)
            if shared_factor == "illumination":
                first_scene, second_scene = randomizer.sample(ENVIRONMENTS, 2)
                controlled_factor = "geometry"
                controlled_value = randomizer.choice(GEOMETRIES)
                first_rows = [one(images, material, controlled_value, first_scene) for material in first_order]
                second_rows = [one(images, material, controlled_value, second_scene) for material in second_order]
            else:
                first_scene, second_scene = randomizer.sample(GEOMETRIES, 2)
                controlled_factor = "illumination"
                controlled_value = randomizer.choice(ENVIRONMENTS)
                first_rows = [one(images, material, first_scene, controlled_value) for material in first_order]
                second_rows = [one(images, material, second_scene, controlled_value) for material in second_order]
            all_rows = first_rows + second_rows
            if shared_factor == "illumination":
                if {str(row.environment_id) for row in first_rows} != {first_scene}:
                    raise RuntimeError("The four lettered samples do not share illumination 1")
                if {str(row.environment_id) for row in second_rows} != {second_scene}:
                    raise RuntimeError("The four numbered samples do not share illumination 2")
                if {str(row.geometry_id) for row in all_rows} != {controlled_value}:
                    raise RuntimeError("An illumination-change setup varies geometry")
            else:
                if {str(row.geometry_id) for row in first_rows} != {first_scene}:
                    raise RuntimeError("The four lettered samples do not share geometry 1")
                if {str(row.geometry_id) for row in second_rows} != {second_scene}:
                    raise RuntimeError("The four numbered samples do not share geometry 2")
                if {str(row.environment_id) for row in all_rows} != {controlled_value}:
                    raise RuntimeError("A geometry-change setup varies illumination")
            target_index = randomizer.randrange(4)
            target_material = first_order[target_index]
            correct_index = second_order.index(target_material)
            trial_id = f"SCENE_{len(public_trials) + 1:04d}"
            for row in first_rows + second_rows:
                make_thumbnail(row)
            public_trials.append({
                "trial_id": trial_id,
                "shared_factor": shared_factor,
                "target_label": "ABCD"[target_index],
                "first_scene": [record(row, thumbnail=True) for row in first_rows],
                "second_scene": [record(row, thumbnail=True) for row in second_rows],
            })
            private_rows.append({
                "trial_id": trial_id,
                "group_id": group_id,
                "shared_factor": shared_factor,
                "first_scene_value": first_scene,
                "second_scene_value": second_scene,
                "controlled_factor": controlled_factor,
                "controlled_value": controlled_value,
                "target_label": "ABCD"[target_index],
                "target_material_id": target_material,
                "correct_option": correct_index + 1,
                "first_material_order": json.dumps(first_order),
                "second_material_order": json.dumps(second_order),
                "first_image_ids": json.dumps([row.image_id for row in first_rows]),
                "second_image_ids": json.dumps([row.image_id for row in second_rows]),
            })
    if len(public_trials) != TRIALS:
        raise RuntimeError(f"Expected {TRIALS} scene-matching trials, found {len(public_trials)}")
    (PUBLIC / "scene_matching_trials.json").write_text(
        json.dumps({"schema_version": 1, "seed": SEED, "trials": public_trials}, separators=(",", ":")),
        encoding="utf-8",
    )
    pd.DataFrame(private_rows).to_csv(AUDIT / "scene_matching_ground_truth.csv", index=False)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--regenerate-scene-matching",
        action="store_true",
        help="Also replace the provisional test-3 scene-matching bank.",
    )
    args = parser.parse_args()
    PUBLIC.mkdir(parents=True, exist_ok=True)
    AUDIT.mkdir(parents=True, exist_ok=True)
    THUMBNAILS.mkdir(parents=True, exist_ok=True)
    images, pairs, _ = load_inputs()
    randomizer = random.Random(SEED)
    generate_forced_choice(images, pairs, randomizer)
    scene_manifest = PUBLIC / "scene_matching_trials.json"
    regenerate_scene = args.regenerate_scene_matching or not scene_manifest.is_file()
    if regenerate_scene:
        generate_scene_matching(images, random.Random(SEED + 1))
    forced_audit = pd.read_csv(AUDIT / "forced_choice_ground_truth.csv")
    triplets = forced_audit.drop_duplicates("trial_id")
    expected_levels = {level: TRIALS // len(DIFFICULTY_LEVELS) for level in DIFFICULTY_LEVELS}
    if triplets.difficulty_level.value_counts().to_dict() != expected_levels:
        raise RuntimeError("Forced-choice difficulty levels are not exactly balanced")
    medians = triplets.groupby("difficulty_level").appearance_gap_different_minus_match.median()
    if not all(medians[left] > medians[right] for left, right in zip(DIFFICULTY_LEVELS, DIFFICULTY_LEVELS[1:])):
        raise RuntimeError(f"Forced-choice appearance gaps are not progressive: {medians.to_dict()}")
    if (forced_audit.reference_image_id == forced_audit.option_image_id).any():
        raise RuntimeError("A forced-choice option repeats its reference image")
    relation_counts = triplets.options_context_relation.value_counts().to_dict()
    expected_relations = {
        relation: TRIALS // len(OPTION_CONTEXT_RELATIONS)
        for relation in OPTION_CONTEXT_RELATIONS
    }
    if relation_counts != expected_relations:
        raise RuntimeError(f"Forced-choice option context relations are not balanced: {relation_counts}")
    (AUDIT / "provenance.json").write_text(json.dumps({
        "schema_version": 1,
        "seed": SEED,
        "forced_choice_trials": TRIALS,
        "scene_matching_trials": TRIALS,
        "dataset": "datasetv7",
        "metadata": str(METADATA.relative_to(ROOT)),
        "candidate_pool": str(CANDIDATES.relative_to(ROOT)),
        "forced_choice_difficulty_definition": "Within-reference percentile of the non-negative material-appearance distance gap: distractor minus physical match. Larger gap is easier; near-zero gap is harder.",
        "forced_choice_level_counts": expected_levels,
        "forced_choice_median_appearance_gap": {level: float(medians[level]) for level in DIFFICULTY_LEVELS},
        "forced_choice_option_context_relations": relation_counts,
        "note": "Scene-matching trials are provisional semirandom groups, not metric-mined difficulty strata.",
    }, indent=2) + "\n", encoding="utf-8")
    scene_action = "regenerated" if regenerate_scene else "preserved"
    print(f"Generated {TRIALS} forced-choice trials; scene-matching manifest {scene_action}")


if __name__ == "__main__":
    main()
