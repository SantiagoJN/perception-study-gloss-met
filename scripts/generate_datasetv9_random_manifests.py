#!/usr/bin/env python3
"""Generate random user-study manifests from datasetv9.

Tests 1, 2 and 4 use random samples constrained to a single material group.
Test 3 uses the pre-rendered groups4 examples in datasetv9/groups4/examples_v9/random30.
"""

from __future__ import annotations

import csv
import json
import random
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT / "perception-study-gloss-met"
PUBLIC = PROJECT / "public"
DATASET = ROOT / "datasetv9" / "renders"
GROUPS4 = ROOT / "datasetv9" / "groups4" / "examples_v9" / "random30"
INSTRUCTION_PAIRS = ROOT / "datasetv9" / "groups4" / "examples_v9" / "instruction_pairs"
SEED = 20261005
DIFFICULTIES = ("easy", "medium_easy", "medium_hard", "hard")
PAIR_STRATA = tuple(f"S{index:02d}" for index in range(1, 9))
RENDER_PATTERN = re.compile(
    r"^\[(?P<environment>[^\]]+)\]\[(?P<geometry>[^\]]+)\]"
    r"\[(?P<group>G\d{2})\]\[(?P<edit>\d{2})_[^\]]+\]"
    r"\[(?P<material>[^\]]+)\]\.png$"
)


@dataclass(frozen=True)
class Render:
    image_id: str
    path: str
    environment: str
    geometry: str
    group: str
    edit: str
    material: str

    @property
    def material_id(self) -> str:
        return f"{self.group}:{self.edit}"

    def image(self) -> dict[str, str]:
        return {
            "image_id": self.image_id,
            "image_path": self.path,
            "material_id": self.material_id,
            "group_id": self.group,
            "geometry_id": self.geometry,
            "environment_id": self.environment,
        }


def atomic_json(path: Path, data: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def read_renders() -> list[Render]:
    renders: list[Render] = []
    for index, path in enumerate(sorted(DATASET.glob("*.png"))):
        match = RENDER_PATTERN.match(path.name)
        if not match:
            raise RuntimeError(f"Unexpected datasetv9 filename: {path.name}")
        info = match.groupdict()
        renders.append(Render(
            image_id=f"v9_{index:04d}",
            path=f"datasetv9/renders/{path.name}",
            environment=info["environment"],
            geometry=info["geometry"],
            group=info["group"],
            edit=info["edit"],
            material=info["material"],
        ))
    if len(renders) != 8100:
        raise RuntimeError(f"Expected 8100 datasetv9 renders, found {len(renders)}")
    return renders


def grouped(renders: list[Render]) -> tuple[dict[str, list[Render]], dict[tuple[str, str], list[Render]]]:
    by_group: dict[str, list[Render]] = defaultdict(list)
    by_material: dict[tuple[str, str], list[Render]] = defaultdict(list)
    for render in renders:
        by_group[render.group].append(render)
        by_material[(render.group, render.edit)].append(render)
    return dict(by_group), dict(by_material)


def different_render(pool: list[Render], reference: Render, rng: random.Random) -> Render:
    options = [item for item in pool if item.path != reference.path]
    return rng.choice(options)


def generate_forced_choices(renders: list[Render], count: int = 120) -> dict[str, Any]:
    rng = random.Random(SEED + 1)
    by_group, by_material = grouped(renders)
    trials = []
    per_level = count // len(DIFFICULTIES)
    for level in DIFFICULTIES:
        for _ in range(per_level):
            group = rng.choice(sorted(by_group))
            edit = rng.choice(sorted({item.edit for item in by_group[group]}))
            reference = rng.choice(by_material[(group, edit)])
            positive = different_render(by_material[(group, edit)], reference, rng)
            negative_edit = rng.choice([candidate for candidate in sorted({item.edit for item in by_group[group]}) if candidate != edit])
            negative = rng.choice(by_material[(group, negative_edit)])
            options = [positive.image(), negative.image()]
            correct = "A"
            if rng.random() < 0.5:
                options.reverse()
                correct = "B"
            trials.append({
                "trial_id": f"V9_FORCED_{len(trials) + 1:04d}",
                "difficulty_level": level,
                "reference": reference.image(),
                "options": options,
                "correct_option": correct,
            })
    rng.shuffle(trials)
    return {"schema_version": 2, "seed": SEED, "dataset": "datasetv9", "trials": trials}


def generate_pair_judgments(renders: list[Render], count: int = 2400) -> list[dict[str, str]]:
    rng = random.Random(SEED + 2)
    by_group, by_material = grouped(renders)
    trials = []
    per_stratum = count // len(PAIR_STRATA)
    for stratum_index, stratum in enumerate(PAIR_STRATA):
        same_material = stratum_index < 4
        for _ in range(per_stratum):
            group = rng.choice(sorted(by_group))
            edits = sorted({item.edit for item in by_group[group]})
            edit_a = rng.choice(edits)
            image_a = rng.choice(by_material[(group, edit_a)])
            if same_material:
                image_b = different_render(by_material[(group, edit_a)], image_a, rng)
                label = "same_material"
            else:
                edit_b = rng.choice([edit for edit in edits if edit != edit_a])
                image_b = rng.choice(by_material[(group, edit_b)])
                label = "different_material_same_group"
            trials.append({
                "pair_id": f"V9_PAIR_{len(trials) + 1:05d}",
                "image_path_a": image_a.path,
                "image_path_b": image_b.path,
                "stratum": stratum,
                "physical_type": label,
                "group_id": group,
            })
    rng.shuffle(trials)
    return trials


def generate_selection_trials(renders: list[Render], count: int = 400) -> dict[str, Any]:
    rng = random.Random(SEED + 3)
    by_group, by_material = grouped(renders)
    trials = []
    for _ in range(count):
        group = rng.choice(sorted(by_group))
        edits = sorted({item.edit for item in by_group[group]})
        edit = rng.choice(edits)
        reference = rng.choice(by_material[(group, edit)])
        positives = rng.sample([item for item in by_material[(group, edit)] if item.path != reference.path], 3)
        negative_edits = [candidate for candidate in edits if candidate != edit]
        negatives = []
        while len(negatives) < 15:
            candidate = rng.choice(by_material[(group, rng.choice(negative_edits))])
            if candidate.path != reference.path and candidate not in negatives:
                negatives.append(candidate)
        candidates = []
        for candidate in positives:
            item = candidate.image()
            item.update({"candidate_id": candidate.image_id, "is_same_material": True})
            candidates.append(item)
        for candidate in negatives:
            item = candidate.image()
            item.update({"candidate_id": candidate.image_id, "is_same_material": False})
            candidates.append(item)
        rng.shuffle(candidates)
        trials.append({
            "trial_id": f"V9_MATCH_{len(trials) + 1:04d}",
            "reference_source_type": "datasetv9",
            "reference": reference.image(),
            "candidates": candidates,
            "positive_count": 3,
            "profile": "random_same_group",
        })
    return {
        "schema_version": "selection-trials-v9-random",
        "seed": SEED,
        "dataset": "datasetv9",
        "candidate_count": 18,
        "maximum_matches_disclosed_to_participant": 3,
        "trials": trials,
    }


def load_groups4_rows(folder: Path) -> list[dict[str, str]]:
    with (folder / "manifest.csv").open(newline="", encoding="utf-8") as stream:
        return list(csv.DictReader(stream))


def rows_to_composite_trials(
    rows: list[dict[str, str]],
    *,
    id_prefix: str,
    pair_key: str,
    change_key: str,
) -> list[dict[str, Any]]:
    by_pair: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        if row["image_png"].endswith(".part"):
            continue
        by_pair[row[pair_key]].append(row)
    trials = []
    for trial_index, pair_id in enumerate(sorted(by_pair), start=1):
        members = sorted(by_pair[pair_id], key=lambda row: row["member"])
        if len(members) != 2:
            continue
        first, second = members
        if first.get("reference_material"):
            first_materials = [first["reference_material"]]
            second_materials = [
                second[f"option_{i}_material"] for i in range(1, 4)
            ]
            repeated = first_materials[0]
            correct_index = int(second["correct_option"]) - 1
            if second_materials[correct_index] != repeated:
                raise RuntimeError(
                    f"Invalid correct option in instruction pair {pair_id}"
                )
            target_label = "R"
        else:
            first_materials = [first[f"material_{i}"] for i in range(1, 5)]
            second_materials = [second[f"material_{i}"] for i in range(1, 5)]
            repeated = next(
                material for material in first_materials
                if material in set(second_materials)
            )
            target_label = "ABCD"[first_materials.index(repeated)]
            correct_index = second_materials.index(repeated)
        material_group = (
            first.get("material_group")
            or first_materials[target_index].split(":", 1)[0]
        )
        trials.append({
            "trial_id": f"{id_prefix}_{trial_index:04d}",
            "shared_factor": first[change_key],
            "target_label": target_label,
            "first_scene": [{
                "image_id": f"{id_prefix.lower()}_{trial_index:04d}_A",
                "image_path": first["image_png"],
                "thumbnail_path": first["image_png"],
                "group_id": material_group,
            }],
            "second_scene": [{
                "image_id": f"{id_prefix.lower()}_{trial_index:04d}_B",
                "image_path": second["image_png"],
                "thumbnail_path": second["image_png"],
                "group_id": material_group,
            }],
            "correct_option": correct_index + 1,
            "slot_materials_scene_1": first_materials,
            "slot_materials_scene_2": second_materials,
        })
    return trials


def read_groups4_trials() -> tuple[dict[str, Any], dict[str, Any]]:
    rows = load_groups4_rows(GROUPS4)
    trials = rows_to_composite_trials(
        rows,
        id_prefix="V9_SCENE",
        pair_key="pair_index",
        change_key="change_type",
    )
    training_rows = load_groups4_rows(INSTRUCTION_PAIRS)
    training_trials = rows_to_composite_trials(
        training_rows,
        id_prefix="V9_TRAIN",
        pair_key=(
            "setup_id"
            if training_rows and training_rows[0].get("setup_id")
            else "pair"
        ),
        change_key="controlled_change",
    )
    if len(trials) < 8:
        raise RuntimeError(f"Expected usable groups4 examples, found {len(trials)}")
    if len(training_trials) != 4:
        raise RuntimeError(f"Expected 4 instruction-pair examples, found {len(training_trials)}")
    payload = {"schema_version": 2, "seed": SEED, "dataset": "datasetv9_groups4_random30", "trials": trials}
    training = {
        "schema_version": 2,
        "dataset": "datasetv9_groups4_instruction_pairs",
        "examples": [
            {**trial, "training_id": trial["trial_id"]}
            for trial in training_trials
        ],
    }
    return payload, training


def generate_testing_answers(forced: dict[str, Any], scene: dict[str, Any], selection: dict[str, Any], pairs: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "pairs": {
            row["pair_id"]: 5 if row["physical_type"] == "same_material" else 1
            for row in pairs
        },
        "forced_choices": {
            row["trial_id"]: row["correct_option"]
            for row in forced["trials"]
        },
        "scene_matches": {
            row["trial_id"]: row["correct_option"]
            for row in scene["trials"]
        },
        "selections": {
            row["trial_id"]: [
                candidate["candidate_id"]
                for candidate in row["candidates"]
                if candidate.get("is_same_material")
            ]
            for row in selection["trials"]
        },
    }


def main() -> None:
    renders = read_renders()
    forced = generate_forced_choices(renders)
    pairs = generate_pair_judgments(renders)
    selection = generate_selection_trials(renders)
    scene, training = read_groups4_trials()
    atomic_json(PUBLIC / "forced_choice_trials.json", forced)
    atomic_json(PUBLIC / "study_pairs.json", pairs)
    atomic_json(PUBLIC / "selection_trials.json", selection)
    atomic_json(PUBLIC / "scene_matching_trials.json", scene)
    atomic_json(PUBLIC / "scene_matching_training.json", training)
    atomic_json(PUBLIC / "testing_ground_truth.json", generate_testing_answers(forced, scene, selection, pairs))
    print(
        f"datasetv9 manifests: {len(forced['trials'])} forced choices, "
        f"{len(pairs)} pairs, {len(selection['trials'])} selections, "
        f"{len(scene['trials'])} groups4 scene trials"
    )


if __name__ == "__main__":
    main()
