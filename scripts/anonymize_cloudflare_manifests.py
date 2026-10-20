#!/usr/bin/env python3
"""Rewrite browser manifests to the opaque object names uploaded to R2."""

from __future__ import annotations

import csv
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROJECT = Path(__file__).resolve().parent.parent
ROOT = PROJECT.parent
PRIVATE = PROJECT / "private/deployment"
SOURCE_MAPPING = PRIVATE / "render_name_mapping.csv"
CLOUDFLARE_MAPPING = PRIVATE / "cloudflare_name_mapping.csv"
PUBLIC = PROJECT / "public"
PAIR_MANIFEST = PUBLIC / "study_pairs.json"
SELECTION_MANIFEST = PUBLIC / "selection_trials.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def atomic_json(path: Path, value: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def load_mapping() -> tuple[dict[str, str], list[dict[str, str]]]:
    if not SOURCE_MAPPING.is_file():
        raise SystemExit(
            f"Missing private mapping {SOURCE_MAPPING}. Copy datasetv7/render_name_mapping.csv there first."
        )
    with SOURCE_MAPPING.open(newline="", encoding="utf-8") as stream:
        source_rows = list(csv.DictReader(stream))
    if len(source_rows) != 3600:
        raise RuntimeError(f"Expected 3600 mapping rows, found {len(source_rows)}")

    rows: list[dict[str, str]] = []
    original_to_cloud: dict[str, str] = {}
    for row in source_rows:
        anonymous = row["anonymous_filename"]
        original = row["original_filename"]
        uploaded_relative_path = f"datasetv7/renders_anon/{anonymous}"
        cloud = hashlib.sha256(uploaded_relative_path.encode("utf-8")).hexdigest() + ".png"
        rows.append({
            "cloudflare_object_filename": cloud,
            "anonymous_filename": anonymous,
            "original_filename": original,
        })
        original_to_cloud[original] = cloud
    if len(original_to_cloud) != 3600 or len({row["cloudflare_object_filename"] for row in rows}) != 3600:
        raise RuntimeError("The deployment mapping is not one-to-one.")
    return original_to_cloud, sorted(rows, key=lambda row: row["cloudflare_object_filename"])


def cloud_name(path: str, original_to_cloud: dict[str, str], known_cloud: set[str]) -> str:
    basename = Path(path).name
    if basename in known_cloud:
        return basename
    try:
        return original_to_cloud[basename]
    except KeyError as cause:
        raise RuntimeError(f"No anonymous Cloudflare object exists for {path}") from cause


def save_private_mapping(rows: list[dict[str, str]]) -> None:
    temporary = CLOUDFLARE_MAPPING.with_suffix(".csv.tmp")
    with temporary.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    os.chmod(temporary, 0o600)
    os.replace(temporary, CLOUDFLARE_MAPPING)


def main() -> None:
    PRIVATE.mkdir(parents=True, exist_ok=True)
    original_to_cloud, mapping_rows = load_mapping()
    known_cloud = {row["cloudflare_object_filename"] for row in mapping_rows}
    save_private_mapping(mapping_rows)

    pairs = json.loads(PAIR_MANIFEST.read_text(encoding="utf-8"))
    selection_payload = json.loads(SELECTION_MANIFEST.read_text(encoding="utf-8"))
    trials = selection_payload["trials"] if isinstance(selection_payload, dict) else selection_payload

    canonical_pairs = PRIVATE / "canonical_study_pairs.json"
    canonical_selection = PRIVATE / "canonical_selection_trials.json"
    if not canonical_pairs.exists() and any("[" in row["image_path_a"] for row in pairs):
        canonical_pairs.write_text(json.dumps(pairs, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        os.chmod(canonical_pairs, 0o600)
    if not canonical_selection.exists() and any("[" in trial["reference"]["image_path"] for trial in trials):
        canonical_selection.write_text(json.dumps(selection_payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        os.chmod(canonical_selection, 0o600)

    for pair in pairs:
        pair["image_path_a"] = cloud_name(pair["image_path_a"], original_to_cloud, known_cloud)
        pair["image_path_b"] = cloud_name(pair["image_path_b"], original_to_cloud, known_cloud)
    for trial in trials:
        trial["reference"]["image_path"] = cloud_name(trial["reference"]["image_path"], original_to_cloud, known_cloud)
        for candidate in trial["candidates"]:
            candidate["image_path"] = cloud_name(candidate["image_path"], original_to_cloud, known_cloud)

    public_paths = [
        path
        for pair in pairs
        for path in (pair["image_path_a"], pair["image_path_b"])
    ] + [
        item["image_path"]
        for trial in trials
        for item in (trial["reference"], *trial["candidates"])
    ]
    if not public_paths or any(path not in known_cloud for path in public_paths):
        raise RuntimeError("A browser manifest still contains a non-Cloudflare stimulus path.")

    atomic_json(PAIR_MANIFEST, pairs)
    atomic_json(SELECTION_MANIFEST, selection_payload)
    provenance = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "mapping_rows": len(mapping_rows),
        "pair_count": len(pairs),
        "selection_trial_count": len(trials),
        "public_stimulus_references": len(public_paths),
        "unique_public_objects_referenced": len(set(public_paths)),
        "study_pairs_sha256": sha256_file(PAIR_MANIFEST),
        "selection_trials_sha256": sha256_file(SELECTION_MANIFEST),
        "note": "Reverse mappings are private and must never be deployed with GitHub Pages.",
    }
    atomic_json(PRIVATE / "anonymous_manifest_provenance.json", provenance)
    print(f"Rewrote {len(pairs)} pairs and {len(trials)} matching trials with opaque R2 object names.")
    print(f"Private deployment mapping: {CLOUDFLARE_MAPPING}")


if __name__ == "__main__":
    main()
