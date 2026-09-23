from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MINING = ROOT / "mining_pairs_v2"
PROJECT = Path(__file__).resolve().parents[1]
OUT = PROJECT / "supabase_seeds"
PUBLIC = PROJECT / "public"


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


selected = read_csv(MINING / "selection" / "pairs_selected_complete.csv")
reserve = read_csv(MINING / "selection" / "pairs_reserve_complete.csv")
metadata = read_csv(MINING / "tables" / "image_metadata_validated.csv")
descriptors = read_csv(MINING / "tables" / "image_descriptors.csv")
public_paths = {
    row["image_png"]: "stimuli/"
    + hashlib.sha256(row["image_png"].encode("utf-8")).hexdigest()
    + ".png"
    for row in metadata
}
eligible = {
    row["image_id"]: row["selection_eligible"].strip().lower() == "true"
    for row in descriptors
}

pair_rows: list[dict[str, object]] = []
for row in selected:
    pair_rows.append(
        {
            "pair_id": row["pair_id"],
            "physical_type": row["physical_type"],
            "provisional_level": row["provisional_level"],
            "change_type": row["change_type"],
            "image_path_a": public_paths[row["image_path_a"]],
            "image_path_b": public_paths[row["image_path_b"]],
            "material_a": row["material_a"],
            "material_b": row["material_b"],
            "group_id": row["group_a"],
            "target_labels": 10,
            "completed_labels": 0,
            "reserved_labels": 0,
            "active": "true",
        }
    )

scene_index: dict[tuple[str, str, str], list[dict[str, str]]] = {}
for row in metadata:
    if not eligible.get(row["image_id"], False):
        continue
    key = (row["group_id"], row["geometry_id"], row["environment_id"])
    scene_index.setdefault(key, []).append(row)

reference_rows: list[dict[str, object]] = []
skipped: list[str] = []
for row in selected + reserve:
    if len(reference_rows) >= 1200:
        break
    if row["physical_type"] != "same_material":
        continue
    key = (row["group_b"], row["geometry_b"], row["environment_b"])
    distractors_by_material: dict[str, str] = {}
    for candidate in scene_index.get(key, []):
        if candidate["material_id"] == row["material_a"]:
            continue
        distractors_by_material.setdefault(
            candidate["material_id"], candidate["image_png"]
        )
    distractors = [
        distractors_by_material[material]
        for material in sorted(distractors_by_material)
    ]
    if len(distractors) != 3:
        skipped.append(row["pair_id"])
        continue
    reference_rows.append(
        {
            "reference_id": "REF_" + row["pair_id"],
            "source_pair_id": row["pair_id"],
            "provisional_level": row["provisional_level"],
            "change_type": row["change_type"],
            "reference_path": public_paths[row["image_path_a"]],
            "correct_candidate_path": public_paths[row["image_path_b"]],
            "distractor_path_1": public_paths[distractors[0]],
            "distractor_path_2": public_paths[distractors[1]],
            "distractor_path_3": public_paths[distractors[2]],
            "target_labels": 10,
            "completed_labels": 0,
            "reserved_labels": 0,
            "active": "true",
        }
    )

if len(pair_rows) != 2400 or len(reference_rows) != 1200:
    raise RuntimeError(
        f"Unexpected seed counts: {len(pair_rows)} pairs, "
        f"{len(reference_rows)} references"
    )

pair_path = OUT / "constancy_pairs.csv"
reference_path = OUT / "constancy_reference_sets.csv"
write_csv(
    PROJECT / "cloudflare_upload_manifest.csv",
    ["source_path", "object_key"],
    [
        {"source_path": row["image_png"], "object_key": public_paths[row["image_png"]]}
        for row in metadata
    ],
)
write_csv(pair_path, list(pair_rows[0]), pair_rows)
write_csv(reference_path, list(reference_rows[0]), reference_rows)

preview = {
    "pairs": [
        {
            "pair_id": row["pair_id"],
            "image_path_a": row["image_path_a"],
            "image_path_b": row["image_path_b"],
        }
        for row in pair_rows[:4]
    ],
    "references": [
        {
            "reference_id": row["reference_id"],
            "reference_path": row["reference_path"],
            "candidate_paths": [
                row["correct_candidate_path"],
                row["distractor_path_1"],
                row["distractor_path_2"],
                row["distractor_path_3"],
            ],
        }
        for row in reference_rows[:2]
    ],
}
PUBLIC.mkdir(parents=True, exist_ok=True)
(PUBLIC / "constancy_preview.json").write_text(
    json.dumps(preview, ensure_ascii=False, separators=(",", ":")),
    encoding="utf-8",
)

manifest = {
    "source": "mining_pairs_v2/selection/pairs_selected_complete.csv",
    "pair_count": len(pair_rows),
    "reference_set_count": len(reference_rows),
    "skipped_selected_reference_pairs": sum(
        pair_id.startswith("V2_PILOT_") for pair_id in skipped
    ),
    "pair_seed_sha256": sha256(pair_path),
    "reference_seed_sha256": sha256(reference_path),
}
(OUT / "manifest.json").write_text(
    json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
)
print(json.dumps(manifest, indent=2))
