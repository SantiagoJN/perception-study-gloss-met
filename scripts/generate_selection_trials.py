#!/usr/bin/env python3
"""Build reproducible 1-reference + 18-candidate material-matching trials.

The script intentionally refuses to run until datasetv7 and mining_pairs_v2 are
complete. It reuses the validated image metadata and pair difficulty scores; it
does not recompute image descriptors. Browser JSON is label-free, while the
private audit tables retain material identity, candidate roles and scores.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from PIL import Image


HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent
ROOT = PROJECT.parent
DEFAULT_MINING = ROOT / "mining_pairs_v2"
DEFAULT_DATASET = ROOT / "datasetv7"
DIFFICULTY_LEVELS = ("easy", "medium_easy", "medium_hard", "hard")


@dataclass(frozen=True)
class Config:
    seed: int = 20260925
    trials: int = 400
    candidates_per_trial: int = 18
    min_positives: int = 4
    max_positives: int = 5
    max_matches_disclosed: int = 5
    max_candidate_image_reuse: int = 8
    max_distractors_per_material: int = 8
    easy_target: float = 0.125
    medium_easy_target: float = 0.375
    medium_hard_target: float = 0.625
    hard_target: float = 0.875
    thumbnail_size: int = 384
    thumbnail_quality: int = 82


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate balanced reference-selection trials from mining_pairs_v2."
    )
    parser.add_argument("--mining-dir", type=Path, default=DEFAULT_MINING)
    parser.add_argument("--dataset-dir", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--output", type=Path, default=PROJECT / "public/selection_trials.json")
    parser.add_argument("--audit-dir", type=Path, default=PROJECT / "stimulus_generation/selection_v1")
    parser.add_argument("--trials", type=int, default=400)
    parser.add_argument("--seed", type=int, default=20260925)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def require_complete(args: argparse.Namespace) -> tuple[Path, Path]:
    dataset_marker = args.dataset_dir / "PNG_COMPLETE"
    mining_marker = args.mining_dir / "COMPLETE"
    pool_path = args.mining_dir / "candidates/candidate_pool.parquet"
    descriptors_path = args.mining_dir / "tables/image_descriptors.parquet"
    missing = [path for path in (dataset_marker, mining_marker, pool_path, descriptors_path) if not path.is_file()]
    if missing:
        formatted = "\n".join(f"  - {path}" for path in missing)
        raise SystemExit(
            "Refusing to generate incomplete stimuli. Wait for G90, datasetv7, and "
            f"mining_pairs_v2 to finish. Missing:\n{formatted}"
        )
    return pool_path, descriptors_path


def bool_series(values: pd.Series) -> pd.Series:
    if values.dtype == bool:
        return values
    return values.astype(str).str.lower().isin({"true", "1", "yes"})


def load_inputs(pool_path: Path, descriptors_path: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    required_pairs = {
        "image_id_a", "image_id_b", "image_path_a", "image_path_b", "material_a", "material_b",
        "group_a", "group_b", "geometry_a", "geometry_b", "environment_a", "environment_b",
        "physical_type", "difficulty_score", "change_type", "pair_qc_valid", "pair_selection_eligible",
    }
    pairs = pd.read_parquet(pool_path)
    missing_pairs = sorted(required_pairs - set(pairs.columns))
    if missing_pairs:
        raise RuntimeError(f"candidate_pool is missing columns: {missing_pairs}")
    pairs = pairs.loc[bool_series(pairs.pair_qc_valid) & bool_series(pairs.pair_selection_eligible)].copy()
    pairs = pairs.loc[np.isfinite(pd.to_numeric(pairs.difficulty_score, errors="coerce"))].copy()
    pairs["difficulty_score"] = pd.to_numeric(pairs.difficulty_score)

    required_images = {"image_id", "image_png", "material_id", "material_type", "group_id", "geometry_id", "environment_id", "qc_valid"}
    images = pd.read_parquet(descriptors_path)
    missing_images = sorted(required_images - set(images.columns))
    if missing_images:
        raise RuntimeError(f"image_descriptors is missing columns: {missing_images}")
    images = images.loc[bool_series(images.qc_valid), list(required_images)].copy()
    images = images.rename(columns={"image_png": "image_path"})
    return pairs, images


def orient_pairs(pairs: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Index each unordered pair in both orientations around a reference image."""
    columns = ["image_id", "image_path", "material_id", "group_id", "geometry_id", "environment_id"]
    by_reference: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in pairs.itertuples(index=False):
        common = {
            "physical_type": row.physical_type,
            "difficulty_score": float(row.difficulty_score),
            "change_type": row.change_type,
            "shortcut_any": bool(getattr(row, "shortcut_any", False)),
            "score_material_appearance": float(getattr(row, "score_material_appearance", np.nan)),
            "score_specular_gloss": float(getattr(row, "score_specular_gloss", np.nan)),
            "score_dino_visual": float(getattr(row, "score_dino_visual", np.nan)),
        }
        a = dict(zip(columns, [row.image_id_a, row.image_path_a, row.material_a, row.group_a, row.geometry_a, row.environment_a]))
        b = dict(zip(columns, [row.image_id_b, row.image_path_b, row.material_b, row.group_b, row.geometry_b, row.environment_b]))
        by_reference[str(row.image_id_a)].append({**b, **common})
        by_reference[str(row.image_id_b)].append({**a, **common})
    return {key: pd.DataFrame(records).drop_duplicates("image_id") for key, records in by_reference.items()}


def choose_references(images: pd.DataFrame, count: int, seed: int) -> list[dict[str, Any]]:
    """Round-robin materials, then contexts, for broad material/geometry/light coverage."""
    random = np.random.default_rng(seed)
    material_groups = {material: frame.copy() for material, frame in images.groupby("material_id", sort=True)}
    if not material_groups:
        raise RuntimeError("No QC-valid reference images are available.")
    order = list(material_groups)
    selected: list[dict[str, Any]] = []
    context_use: Counter[tuple[str, str]] = Counter()
    material_use: Counter[str] = Counter()
    while len(selected) < count:
        progressed = False
        for material in order:
            frame = material_groups[material]
            used_ids = {entry["image_id"] for entry in selected}
            options = frame.loc[~frame.image_id.isin(used_ids)].copy()
            if options.empty:
                continue
            options["cost"] = [
                context_use[(str(g), str(e))] + material_use[material] * 0.05 + random.random() * 0.01
                for g, e in zip(options.geometry_id, options.environment_id)
            ]
            row = options.sort_values(["cost", "image_id"]).iloc[0].to_dict()
            selected.append(row)
            context_use[(str(row["geometry_id"]), str(row["environment_id"]))] += 1
            material_use[material] += 1
            progressed = True
            if len(selected) == count:
                break
        if not progressed:
            raise RuntimeError(f"Could select only {len(selected)} unique references, requested {count}.")
    return selected


def tiers(count: int, positive: bool, config: Config, offset: int) -> list[tuple[str, float, str]]:
    """Return all four difficulty levels, distributing surplus slots evenly."""
    if count < len(DIFFICULTY_LEVELS):
        raise RuntimeError("Four difficulty levels require at least four candidates per physical type.")
    targets = {
        "easy": config.easy_target,
        "medium_easy": config.medium_easy_target,
        "medium_hard": config.medium_hard_target,
        "hard": config.hard_target,
    }
    counts = {level: count // len(DIFFICULTY_LEVELS) for level in DIFFICULTY_LEVELS}
    for index in range(count % len(DIFFICULTY_LEVELS)):
        counts[DIFFICULTY_LEVELS[(offset + index) % len(DIFFICULTY_LEVELS)]] += 1
    prefix = "positive" if positive else "distractor"
    result = [
        (f"{prefix}_{level}", targets[level], level)
        for level in DIFFICULTY_LEVELS
        for _ in range(counts[level])
    ]
    if len(result) != count:
        raise RuntimeError(f"Configured role counts produce {len(result)} candidates, expected {count}")
    return result


def difficulty_band(values: pd.Series, config: Config) -> pd.Series:
    percentiles = pd.to_numeric(values).rank(method="first", pct=True)
    return pd.cut(
        percentiles,
        bins=[0.0, 0.25, 0.50, 0.75, 1.0],
        labels=list(DIFFICULTY_LEVELS),
        include_lowest=True,
    ).astype(str)


def select_candidate(
    pool: pd.DataFrame,
    target: float,
    role: str,
    selected_ids: set[str],
    image_use: Counter[str],
    material_use: Counter[str],
    config: Config,
    random: random.Random,
    required_band: str,
    preferred_change: str | None = None,
) -> dict[str, Any]:
    options = pool.loc[
        (~pool.image_id.astype(str).isin(selected_ids))
        & (pool.difficulty_band.astype(str) == required_band)
    ].copy()
    options = options.loc[
        options.image_id.astype(str).map(image_use) < config.max_candidate_image_reuse
    ].copy()
    if role.startswith("distractor"):
        options = options.loc[
            options.material_id.astype(str).map(material_use) < config.max_distractors_per_material
        ].copy()
    if options.empty:
        raise RuntimeError(
            f"No candidate remains for role={role}, band={required_band}, "
            "after applying the strict reuse and per-material caps."
        )
    preferred = options.loc[options.change_type.astype(str) == preferred_change].copy() if preferred_change else options
    preferred_change_met = not preferred.empty
    if preferred_change_met:
        options = preferred
    jitter = np.array([random.random() for _ in range(len(options))]) * .015
    shortcut = options.shortcut_any.fillna(False).astype(bool).to_numpy(dtype=float) * .08
    reuse = options.image_id.astype(str).map(image_use).to_numpy(dtype=float) * .025
    material_balance = options.material_id.astype(str).map(material_use).to_numpy(dtype=float) * .12 if role.startswith("distractor") else 0.0
    options["_cost"] = np.abs(options.difficulty_score.to_numpy() - target) + shortcut + reuse + material_balance + jitter
    row = options.sort_values(["_cost", "image_id"]).iloc[0].to_dict()
    candidate_id = str(row["image_id"])
    selected_ids.add(candidate_id)
    image_use[candidate_id] += 1
    material_use[str(row["material_id"])] += 1
    row["role"] = role
    row["difficulty_band"] = required_band
    row["preferred_change_type"] = preferred_change
    row["preferred_change_met"] = preferred_change_met
    return row


def make_trials(pairs: pd.DataFrame, images: pd.DataFrame, config: Config) -> tuple[list[dict[str, Any]], pd.DataFrame]:
    by_reference = orient_pairs(pairs)
    eligible_images = images.loc[images.image_id.astype(str).isin(by_reference)].copy()
    references = choose_references(eligible_images, config.trials, config.seed)
    random_source = random.Random(config.seed)
    image_use: Counter[str] = Counter()
    private_trials: list[dict[str, Any]] = []
    audit_rows: list[dict[str, Any]] = []
    for trial_index, reference in enumerate(references):
        reference_id = str(reference["image_id"])
        pool = by_reference[reference_id].copy()
        positives = pool.loc[pool.physical_type == "same_material"]
        negatives = pool.loc[(pool.physical_type == "different_material") & (pool.group_id.astype(str) == str(reference["group_id"]))]
        positives = positives.assign(difficulty_band=difficulty_band(positives.difficulty_score, config))
        negatives = negatives.assign(difficulty_band=difficulty_band(negatives.difficulty_score, config))
        material = str(reference["material_id"])
        positive_count = config.min_positives + trial_index % (
            config.max_positives - config.min_positives + 1
        )
        negative_count = config.candidates_per_trial - positive_count
        if len(positives) < positive_count or len(negatives) < negative_count:
            raise RuntimeError(f"Reference {reference_id} has insufficient candidates: {len(positives)} positives, {len(negatives)} negatives.")

        chosen: list[dict[str, Any]] = []
        selected_ids: set[str] = set()
        distractor_material_use: Counter[str] = Counter()
        positive_changes = ["illumination_only", "geometry_only", "geometry_and_illumination"]
        positive_changes = positive_changes[trial_index % 3:] + positive_changes[:trial_index % 3]
        negative_changes = ["same_scene", "geometry_only", "illumination_only", "geometry_and_illumination"]
        for candidate_index, (role, target, band) in enumerate(tiers(positive_count, True, config, trial_index)):
            chosen.append(select_candidate(
                positives, target, role, selected_ids, image_use, Counter(), config, random_source,
                band, positive_changes[candidate_index % len(positive_changes)],
            ))
        for candidate_index, (role, target, band) in enumerate(tiers(negative_count, False, config, trial_index + 2)):
            try:
                chosen.append(select_candidate(
                    negatives, target, role, selected_ids, image_use, distractor_material_use, config, random_source,
                    band, negative_changes[candidate_index % len(negative_changes)],
                ))
            except RuntimeError as cause:
                raise RuntimeError(
                    f"Trial {trial_index + 1}, reference={reference_id}, material={material}, "
                    f"positive_count={positive_count}, distractor_material_use={dict(distractor_material_use)}: {cause}"
                ) from cause
        random_source.shuffle(chosen)

        trial_id = f"MATCH_{trial_index + 1:04d}"
        private_trials.append({
            "trial_id": trial_id,
            "reference": reference,
            "candidates": chosen,
            "positive_count": positive_count,
            "profile": "factorial_four_difficulty_levels_x_same_different",
            "reference_source_type": "svbrdf" if str(reference["material_type"]).startswith("svbrdf") else "measured",
        })
        for position, candidate in enumerate(chosen, start=1):
            audit_rows.append({
                "trial_id": trial_id,
                "candidate_position_pre_browser_shuffle": position,
                "reference_image_id": reference_id,
                "reference_image_path": reference["image_path"],
                "reference_material_id": reference["material_id"],
                "reference_group_id": reference["group_id"],
                "reference_geometry_id": reference["geometry_id"],
                "reference_environment_id": reference["environment_id"],
                "candidate_image_id": candidate["image_id"],
                "candidate_image_path": candidate["image_path"],
                "candidate_material_id": candidate["material_id"],
                "candidate_group_id": candidate["group_id"],
                "candidate_geometry_id": candidate["geometry_id"],
                "candidate_environment_id": candidate["environment_id"],
                "is_same_material": candidate["physical_type"] == "same_material",
                "candidate_role": candidate["role"],
                "difficulty_score": candidate["difficulty_score"],
                "difficulty_band": candidate["difficulty_band"],
                "change_type": candidate["change_type"],
                "preferred_change_type": candidate["preferred_change_type"],
                "preferred_change_met": candidate["preferred_change_met"],
                "shortcut_any": candidate["shortcut_any"],
                "score_material_appearance": candidate["score_material_appearance"],
                "score_specular_gloss": candidate["score_specular_gloss"],
                "score_dino_visual": candidate["score_dino_visual"],
            })
    return private_trials, pd.DataFrame(audit_rows)


def public_manifest(trials: list[dict[str, Any]], config: Config) -> dict[str, Any]:
    return {
        "schema_version": "selection-trials-v1",
        "seed": config.seed,
        "candidate_count": config.candidates_per_trial,
        "maximum_matches_disclosed_to_participant": config.max_matches_disclosed,
        "trials": [
            {
                "trial_id": trial["trial_id"],
                "reference_source_type": trial["reference_source_type"],
                "reference": {
                    "image_id": str(trial["reference"]["image_id"]),
                    "image_path": str(trial["reference"]["image_path"]),
                    "thumbnail_path": f"selection_thumbnails/{trial['reference']['image_id']}.webp",
                },
                "candidates": [
                    {"candidate_id": str(candidate["image_id"]), "image_id": str(candidate["image_id"]), "image_path": str(candidate["image_path"]), "thumbnail_path": f"selection_thumbnails/{candidate['image_id']}.webp"}
                    for candidate in trial["candidates"]
                ],
            }
            for trial in trials
        ],
    }


def validate_trials(trials: list[dict[str, Any]], audit: pd.DataFrame, config: Config) -> None:
    if len(trials) != config.trials or len(audit) != config.trials * config.candidates_per_trial:
        raise RuntimeError("Generated trial count does not match the configured factorial size.")
    if any(len({str(item["image_id"]) for item in trial["candidates"]}) != config.candidates_per_trial for trial in trials):
        raise RuntimeError("A generated trial contains duplicate candidates.")
    if (audit.reference_image_id.astype(str) == audit.candidate_image_id.astype(str)).any():
        raise RuntimeError("A generated trial repeats the exact reference image as a candidate.")
    for level in DIFFICULTY_LEVELS:
        roles = {f"positive_{level}", f"distractor_{level}"}
        rows = audit.loc[audit.candidate_role.astype(str).isin(roles)]
        if not (rows.difficulty_band.astype(str) == level).all():
            raise RuntimeError(f"A {level} role escaped its strict difficulty band.")
    for (_, _), frame in audit.groupby(["trial_id", "is_same_material"]):
        bounds = frame.groupby("difficulty_band").difficulty_score.agg(["min", "max"])
        present = [band for band in DIFFICULTY_LEVELS if band in bounds.index]
        if any(float(bounds.loc[left, "max"]) > float(bounds.loc[right, "min"]) for left, right in zip(present, present[1:])):
            raise RuntimeError("Difficulty bands overlap within a generated trial.")
    if int(audit.groupby("candidate_image_id").size().max()) > config.max_candidate_image_reuse:
        raise RuntimeError("Candidate image reuse exceeds the configured hard cap.")
    distractors = audit.loc[~audit.is_same_material.astype(bool)]
    if int(distractors.groupby(["trial_id", "candidate_material_id"]).size().max()) > config.max_distractors_per_material:
        raise RuntimeError("Per-trial distractor material reuse exceeds the configured hard cap.")
    expected_roles = {
        f"{prefix}_{level}"
        for prefix in ("positive", "distractor")
        for level in DIFFICULTY_LEVELS
    }
    role_counts = audit.groupby(["trial_id", "candidate_role"]).size().unstack(fill_value=0)
    for role in expected_roles:
        if role not in role_counts or not (role_counts[role] >= 1).all():
            raise RuntimeError(f"Every setup must contain at least one candidate with role {role}.")
    unexpected = sorted(set(role_counts.columns) - expected_roles)
    if unexpected:
        raise RuntimeError(f"Unexpected candidate roles were generated: {unexpected}")
    reference_counts = audit.drop_duplicates("trial_id").reference_material_id.value_counts()
    if len(reference_counts) != 60 or reference_counts.max() - reference_counts.min() > 1:
        raise RuntimeError("Reference materials are not balanced across the 400 setups.")
    positive_distribution = audit.groupby("trial_id").is_same_material.sum().value_counts().sort_index()
    expected_per_count = config.trials // (config.max_positives - config.min_positives + 1)
    if positive_distribution.to_dict() != {
        count: expected_per_count for count in range(config.min_positives, config.max_positives + 1)
    }:
        raise RuntimeError(f"Positive-count distribution is not balanced: {positive_distribution.to_dict()}")


def generate_thumbnails(trials: list[dict[str, Any]], config: Config) -> tuple[Path, int]:
    output_dir = PROJECT / "public/selection_thumbnails"
    output_dir.mkdir(parents=True, exist_ok=True)
    images: dict[str, str] = {}
    for trial in trials:
        images[str(trial["reference"]["image_id"])] = str(trial["reference"]["image_path"])
        for candidate in trial["candidates"]:
            images[str(candidate["image_id"])] = str(candidate["image_path"])
    for image_id, relative_source in images.items():
        source = (ROOT / relative_source).resolve()
        try:
            source.relative_to(ROOT.resolve())
        except ValueError as cause:
            raise RuntimeError(f"Thumbnail source is unsafe: {relative_source}") from cause
        if not source.is_file():
            raise RuntimeError(f"Thumbnail source is unavailable or unsafe: {relative_source}")
        destination = output_dir / f"{image_id}.webp"
        if destination.is_file() and destination.stat().st_mtime_ns >= source.stat().st_mtime_ns:
            continue
        with Image.open(source) as image:
            image.thumbnail((config.thumbnail_size, config.thumbnail_size), Image.Resampling.LANCZOS)
            image.convert("RGB").save(destination, "WEBP", quality=config.thumbnail_quality, method=6)
    return output_dir, len(images)


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def main() -> None:
    args = parse_args()
    config = Config(seed=args.seed, trials=args.trials)
    if config.candidates_per_trial != 18 or not (2 <= config.min_positives <= config.max_positives <= config.max_matches_disclosed):
        raise SystemExit("This study version requires 18 candidates and at most five positive matches.")
    pool_path, descriptors_path = require_complete(args)
    pairs, images = load_inputs(pool_path, descriptors_path)
    trials, audit = make_trials(pairs, images, config)
    validate_trials(trials, audit, config)
    thumbnail_dir, thumbnail_count = generate_thumbnails(trials, config)
    manifest = public_manifest(trials, config)

    args.audit_dir.mkdir(parents=True, exist_ok=True)
    atomic_json(args.output, manifest)
    audit.to_csv(args.audit_dir / "selection_trials_ground_truth.csv", index=False)
    pd.DataFrame([
        {"trial_id": key, "candidate_role": role, "count": count}
        for (key, role), count in audit.groupby(["trial_id", "candidate_role"]).size().items()
    ]).to_csv(args.audit_dir / "trial_composition.csv", index=False)
    provenance = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "config": asdict(config),
        "source_candidate_pool": str(pool_path.relative_to(ROOT)),
        "source_candidate_pool_sha256": sha256(pool_path),
        "source_descriptors": str(descriptors_path.relative_to(ROOT)),
        "source_descriptors_sha256": sha256(descriptors_path),
        "public_manifest": str(args.output.relative_to(ROOT)),
        "public_manifest_sha256": sha256(args.output),
        "trials": len(trials),
        "candidates": len(audit),
        "thumbnails": thumbnail_count,
        "thumbnail_directory": str(thumbnail_dir.relative_to(ROOT)),
        "positive_count_distribution": audit.groupby("trial_id").is_same_material.sum().value_counts().sort_index().to_dict(),
        "candidate_role_counts_per_trial": {
            role: {"min": int(values.min()), "max": int(values.max())}
            for role, values in audit.groupby(["trial_id", "candidate_role"]).size().groupby("candidate_role")
        },
        "validation": {
            "setups_with_all_eight_strata": int(audit.groupby("trial_id").candidate_role.nunique().eq(8).sum()),
            "exact_reference_image_as_candidate": int((audit.reference_image_id.astype(str) == audit.candidate_image_id.astype(str)).sum()),
            "duplicate_candidates_within_setup": int(audit.duplicated(["trial_id", "candidate_image_id"]).sum()),
            "unique_references": int(audit.reference_image_id.nunique()),
            "reference_uses_per_material_min": int(audit.drop_duplicates("trial_id").reference_material_id.value_counts().min()),
            "reference_uses_per_material_max": int(audit.drop_duplicates("trial_id").reference_material_id.value_counts().max()),
            "observed_maximum_candidate_image_reuse": int(audit.groupby("candidate_image_id").size().max()),
        },
        "difficulty_score_median_by_role": {
            role: float(value)
            for role, value in audit.groupby("candidate_role").difficulty_score.median().items()
        },
        "strict_constraints": {
            "difficulty_quantile_bands_per_reference_and_physical_type": {
                "easy": [0.0, 0.25],
                "medium_easy": [0.25, 0.50],
                "medium_hard": [0.50, 0.75],
                "hard": [0.75, 1.0],
            },
            "silent_relaxations": 0,
            "maximum_candidate_image_reuse": config.max_candidate_image_reuse,
            "maximum_distractors_per_material_per_trial": config.max_distractors_per_material,
        },
        "audited_change_type_substitutions": int((~audit.preferred_change_met.astype(bool)).sum()),
        "note": "Automatic difficulty is a mining heuristic, not validated human difficulty.",
    }
    atomic_json(args.audit_dir / "provenance.json", provenance)
    print(f"Wrote {len(trials)} trials / {len(audit)} candidates to {args.output}")


if __name__ == "__main__":
    main()
