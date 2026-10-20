#!/usr/bin/env python3
"""Build the immutable 12 x 50 participant sets for all four study tasks.

The source manifests contain 75 trials in every cell of a 4 (difficulty) x 2
(task-specific condition) design.  Every fixed set receives six trials from
each cell plus two rotating extras.  Consequently each set contains exactly
50 trials, exactly 25 trials from either condition, and a 12/12/13/13 split
over difficulty.  Across the twelve sets, every trial appears exactly once.

Tests 2--4 share family IDs.  Their allocations additionally forbid a family
from receiving the same set number in more than one of those tests.  This
prevents a participant assigned to one set number from seeing a base Test-2
setup and one of its extensions in Test 3 or Test 4.
"""

from __future__ import annotations

import csv
import hashlib
import json
import random
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


PROJECT = Path(__file__).resolve().parents[1]
PUBLIC = PROJECT / "public"
AUDIT = PROJECT / "stimulus_generation" / "fixed_trial_groups_v1"
OUTPUT_JSON = PUBLIC / "fixed_trial_groups.json"
SEED = "datasetv9-fixed-trial-groups-v1"
GROUP_COUNT = 12
GROUP_SIZE = 50
DIFFICULTIES = ("easy", "medium_easy", "medium_hard", "hard")


@dataclass(frozen=True)
class TestSpec:
    key: str
    filename: str
    id_field: str
    secondary_name: str
    secondary_values: tuple[Any, Any]
    secondary: Callable[[dict[str, Any]], Any]
    family_field: str | None = None


SPECS = (
    TestSpec("test1", "study_pairs.json", "pair_id", "physical_type", ("same_material", "different_material"), lambda row: row["physical_type"]),
    TestSpec("test2", "forced_choice_trials.json", "trial_id", "correct_option", ("A", "B"), lambda row: row["correct_option"], "family_id"),
    TestSpec("test3", "scene_matching_trials.json", "trial_id", "shared_factor", ("geometry", "illumination"), lambda row: row["shared_factor"], "family_id"),
    TestSpec("test4", "selection_trials.json", "trial_id", "positive_count", (1, 2), lambda row: row["positive_count"], "family_id"),
)


def stable_rng(label: str) -> random.Random:
    digest = hashlib.sha256(f"{SEED}:{label}".encode("utf-8")).digest()
    return random.Random(int.from_bytes(digest[:8], "big"))


def load_trials(filename: str) -> tuple[list[dict[str, Any]], str]:
    path = PUBLIC / filename
    raw = path.read_bytes()
    payload = json.loads(raw)
    trials = payload if isinstance(payload, list) else payload["trials"]
    if len(trials) != GROUP_COUNT * GROUP_SIZE:
        raise RuntimeError(f"{filename}: expected 600 trials, found {len(trials)}")
    return trials, hashlib.sha256(raw).hexdigest()


def group_id(row: dict[str, Any], spec: TestSpec, test2_by_family: dict[str, dict[str, Any]]) -> str:
    if spec.key == "test1":
        return row["group_id"]
    source = row if spec.key in {"test2", "test4"} else test2_by_family[row["family_id"]]
    return source["reference"]["group_id"]


def reference_geometry(row: dict[str, Any], spec: TestSpec, test2_by_family: dict[str, dict[str, Any]]) -> str:
    if spec.key == "test1":
        return ""
    source = row if spec.key in {"test2", "test4"} else test2_by_family[row["family_id"]]
    return source["reference"]["geometry_id"]


def reference_illumination(row: dict[str, Any], spec: TestSpec, test2_by_family: dict[str, dict[str, Any]]) -> str:
    if spec.key == "test1":
        return ""
    source = row if spec.key in {"test2", "test4"} else test2_by_family[row["family_id"]]
    return source["reference"]["illumination_id"]


def cell_quotas(difficulty_index: int, secondary_index: int) -> list[int]:
    # Six per cell gives 48 trials per set. Each secondary condition contributes
    # one rotating extra, producing 25/25 and two distinct 13-count difficulties.
    return [
        6 + int((set_index + secondary_index) % len(DIFFICULTIES) == difficulty_index)
        for set_index in range(GROUP_COUNT)
    ]


def allocate_cell(
    rows: list[dict[str, Any]],
    quotas: list[int],
    row_id: Callable[[dict[str, Any]], str],
    family_id: Callable[[dict[str, Any]], str | None],
    forbidden: dict[str, set[int]],
    rng: random.Random,
) -> dict[str, int]:
    if sum(quotas) != len(rows):
        raise RuntimeError("Cell quotas do not match the available trials")
    for _ in range(2_000):
        remaining = quotas.copy()
        ordered = list(rows)
        rng.shuffle(ordered)
        assignment: dict[str, int] = {}
        failed = False
        for row in ordered:
            family = family_id(row)
            blocked = forbidden.get(family, set()) if family is not None else set()
            candidates = [index for index, count in enumerate(remaining) if count and index not in blocked]
            if not candidates:
                failed = True
                break
            highest = max(remaining[index] for index in candidates)
            best = [index for index in candidates if remaining[index] == highest]
            chosen = rng.choice(best)
            assignment[row_id(row)] = chosen
            remaining[chosen] -= 1
        if not failed and not any(remaining):
            return assignment
    raise RuntimeError("Could not satisfy the cross-test family exclusions")


def optimize_diversity(
    rows: list[dict[str, Any]],
    spec: TestSpec,
    assignment: dict[str, int],
    forbidden: dict[str, set[int]],
    test2_by_family: dict[str, dict[str, Any]],
) -> tuple[float, float]:
    row_id = lambda row: str(row[spec.id_field])
    by_id = {row_id(row): row for row in rows}
    groups: list[list[str]] = [[] for _ in range(GROUP_COUNT)]
    cells: dict[tuple[str, Any], list[str]] = defaultdict(list)
    for row in rows:
        identifier = row_id(row)
        groups[assignment[identifier]].append(identifier)
        cells[(row["difficulty_level"], spec.secondary(row))].append(identifier)

    extractors: list[tuple[str, float, Callable[[dict[str, Any]], str]]] = [
        ("material_group", 4.0, lambda row: group_id(row, spec, test2_by_family)),
    ]
    if spec.key != "test1":
        extractors.extend([
            ("reference_geometry", 1.0, lambda row: reference_geometry(row, spec, test2_by_family)),
            ("reference_illumination", 1.0, lambda row: reference_illumination(row, spec, test2_by_family)),
        ])
    if spec.key == "test3":
        extractors.append(("correct_position", 1.5, lambda row: str(row["correct_option"])))

    totals = {
        name: Counter(extractor(row) for row in rows)
        for name, _, extractor in extractors
    }

    def cost(group: list[str]) -> float:
        value = 0.0
        group_rows = [by_id[identifier] for identifier in group]
        for name, weight, extractor in extractors:
            counts = Counter(extractor(row) for row in group_rows)
            for category, total in totals[name].items():
                target = total / GROUP_COUNT
                value += weight * (counts[category] - target) ** 2 / max(target, 1.0)
        return value

    initial = sum(cost(group) for group in groups)
    rng = stable_rng(f"{spec.key}:diversity")
    cell_values = list(cells.values())
    # The exact experimental balances are already guaranteed by construction;
    # these swaps only improve secondary scene/material diversity.
    for _ in range(12_000):
        identifiers = rng.choice(cell_values)
        first, second = rng.sample(identifiers, 2)
        first_group, second_group = assignment[first], assignment[second]
        if first_group == second_group:
            continue
        first_row, second_row = by_id[first], by_id[second]
        if spec.family_field:
            if second_group in forbidden.get(str(first_row[spec.family_field]), set()):
                continue
            if first_group in forbidden.get(str(second_row[spec.family_field]), set()):
                continue
        old_cost = cost(groups[first_group]) + cost(groups[second_group])
        next_first = [second if identifier == first else identifier for identifier in groups[first_group]]
        next_second = [first if identifier == second else identifier for identifier in groups[second_group]]
        new_cost = cost(next_first) + cost(next_second)
        if new_cost + 1e-12 < old_cost:
            groups[first_group] = next_first
            groups[second_group] = next_second
            assignment[first], assignment[second] = second_group, first_group
    return initial, sum(cost(group) for group in groups)


def build_assignment(
    rows: list[dict[str, Any]],
    spec: TestSpec,
    forbidden: dict[str, set[int]],
    test2_by_family: dict[str, dict[str, Any]],
) -> tuple[dict[str, int], tuple[float, float]]:
    row_id = lambda row: str(row[spec.id_field])
    family_id = (lambda row: str(row[spec.family_field])) if spec.family_field else (lambda row: None)
    assignment: dict[str, int] = {}
    for difficulty_index, difficulty in enumerate(DIFFICULTIES):
        for secondary_index, secondary in enumerate(spec.secondary_values):
            cell = [row for row in rows if row["difficulty_level"] == difficulty and spec.secondary(row) == secondary]
            if len(cell) != 75:
                raise RuntimeError(f"{spec.key}: expected 75 trials in {difficulty}/{secondary}, found {len(cell)}")
            rng = stable_rng(f"{spec.key}:{difficulty}:{secondary}")
            assignment.update(allocate_cell(cell, cell_quotas(difficulty_index, secondary_index), row_id, family_id, forbidden, rng))
    if len(assignment) != GROUP_COUNT * GROUP_SIZE:
        raise RuntimeError(f"{spec.key}: assignment is incomplete")
    return assignment, optimize_diversity(rows, spec, assignment, forbidden, test2_by_family)


def counts_for_group(rows: list[dict[str, Any]], spec: TestSpec) -> dict[str, dict[str, int]]:
    return {
        "difficulty": dict(Counter(str(row["difficulty_level"]) for row in rows)),
        spec.secondary_name: dict(Counter(str(spec.secondary(row)) for row in rows)),
    }


def main() -> None:
    loaded: dict[str, list[dict[str, Any]]] = {}
    hashes: dict[str, str] = {}
    for spec in SPECS:
        loaded[spec.key], hashes[spec.key] = load_trials(spec.filename)

    test2_by_family = {row["family_id"]: row for row in loaded["test2"]}
    family_sets = [{row["family_id"] for row in loaded[key]} for key in ("test2", "test3", "test4")]
    if any(families != family_sets[0] for families in family_sets[1:]):
        raise RuntimeError("Tests 2, 3 and 4 do not contain the same 600 families")
    for family in family_sets[0]:
        levels = {next(row for row in loaded[key] if row["family_id"] == family)["difficulty_level"] for key in ("test2", "test3", "test4")}
        if len(levels) != 1:
            raise RuntimeError(f"Family {family} changes difficulty between inherited tests")

    assignments: dict[str, dict[str, int]] = {}
    optimization: dict[str, tuple[float, float]] = {}
    family_group: dict[str, dict[str, int]] = {}
    for spec in SPECS:
        forbidden: dict[str, set[int]] = defaultdict(set)
        if spec.key in {"test3", "test4"}:
            for earlier in ("test2", "test3"):
                if earlier == spec.key or earlier not in family_group:
                    continue
                for family, set_index in family_group[earlier].items():
                    forbidden[family].add(set_index)
        assignments[spec.key], optimization[spec.key] = build_assignment(loaded[spec.key], spec, forbidden, test2_by_family)
        if spec.family_field:
            family_group[spec.key] = {
                row[spec.family_field]: assignments[spec.key][row[spec.id_field]]
                for row in loaded[spec.key]
            }

    for left, right in (("test2", "test3"), ("test2", "test4"), ("test3", "test4")):
        overlap = sum(family_group[left][family] == family_group[right][family] for family in family_sets[0])
        if overlap:
            raise RuntimeError(f"{left}/{right}: {overlap} inherited families share a set number")

    manifest: dict[str, Any] = {
        "schema_version": 1,
        "seed": SEED,
        "group_count": GROUP_COUNT,
        "group_size": GROUP_SIZE,
        "tests": {},
    }
    audit_rows: list[dict[str, Any]] = []
    report: dict[str, Any] = {"tests": {}, "cross_test_same_set_family_overlap": {}}

    for spec in SPECS:
        by_id = {str(row[spec.id_field]): row for row in loaded[spec.key]}
        groups_payload = []
        test_report = []
        for set_index in range(GROUP_COUNT):
            identifiers = [identifier for identifier, assigned in assignments[spec.key].items() if assigned == set_index]
            stable_rng(f"{spec.key}:set:{set_index + 1}:order").shuffle(identifiers)
            if len(identifiers) != GROUP_SIZE:
                raise RuntimeError(f"{spec.key}/set_{set_index + 1:02d}: expected 50 trials, found {len(identifiers)}")
            rows = [by_id[identifier] for identifier in identifiers]
            counts = counts_for_group(rows, spec)
            difficulty_values = sorted(counts["difficulty"].values())
            if difficulty_values != [12, 12, 13, 13]:
                raise RuntimeError(f"{spec.key}/set_{set_index + 1:02d}: invalid difficulty allocation {counts}")
            if sorted(counts[spec.secondary_name].values()) != [25, 25]:
                raise RuntimeError(f"{spec.key}/set_{set_index + 1:02d}: invalid condition allocation {counts}")
            set_id = f"set_{set_index + 1:02d}"
            groups_payload.append({"set_id": set_id, "trial_ids": identifiers, "counts": counts})
            material_counts = Counter(group_id(row, spec, test2_by_family) for row in rows)
            test_report.append({"set_id": set_id, "counts": counts, "material_group_counts": dict(sorted(material_counts.items()))})
            for order, identifier in enumerate(identifiers, 1):
                row = by_id[identifier]
                audit_rows.append({
                    "test": spec.key,
                    "set_id": set_id,
                    "fixed_order": order,
                    "trial_id": identifier,
                    "difficulty_level": row["difficulty_level"],
                    spec.secondary_name: spec.secondary(row),
                    "material_group": group_id(row, spec, test2_by_family),
                    "family_id": row.get("family_id", ""),
                })
        all_ids = [identifier for group in groups_payload for identifier in group["trial_ids"]]
        if len(all_ids) != len(set(all_ids)) or set(all_ids) != set(by_id):
            raise RuntimeError(f"{spec.key}: groups do not form an exact partition of the manifest")
        manifest["tests"][spec.key] = {
            "source_manifest": spec.filename,
            "source_sha256": hashes[spec.key],
            "id_field": spec.id_field,
            "secondary_balance": spec.secondary_name,
            "groups": groups_payload,
        }
        report["tests"][spec.key] = {
            "diversity_cost_before": optimization[spec.key][0],
            "diversity_cost_after": optimization[spec.key][1],
            "groups": test_report,
        }

    for left, right in (("test2", "test3"), ("test2", "test4"), ("test3", "test4")):
        report["cross_test_same_set_family_overlap"][f"{left}_{right}"] = sum(
            family_group[left][family] == family_group[right][family] for family in family_sets[0]
        )

    AUDIT.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (AUDIT / "fixed_trial_groups.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (AUDIT / "validation_report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    fieldnames = ["test", "set_id", "fixed_order", "trial_id", "difficulty_level", "physical_type", "correct_option", "shared_factor", "positive_count", "material_group", "family_id"]
    with (AUDIT / "assignments.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(audit_rows)

    lines = [
        "# Fixed participant trial groups v1",
        "",
        f"Seed: `{SEED}`. Each test is partitioned into {GROUP_COUNT} immutable sets of {GROUP_SIZE} regular trials.",
        "Each set has a 12/12/13/13 difficulty allocation and a 25/25 allocation of its task-specific binary condition.",
        "Tests 2, 3 and 4 have zero inherited-family overlap for equal set numbers.",
        "",
    ]
    for spec in SPECS:
        lines.extend([f"## {spec.key}", "", f"Secondary balance: `{spec.secondary_name}`.", "", "| Set | Easy | Medium-easy | Medium-hard | Hard | Condition counts |", "|---|---:|---:|---:|---:|---|"])
        for group in manifest["tests"][spec.key]["groups"]:
            difficulty = group["counts"]["difficulty"]
            secondary = group["counts"][spec.secondary_name]
            conditions = ", ".join(f"{key}: {value}" for key, value in secondary.items())
            lines.append(f"| {group['set_id']} | {difficulty.get('easy', 0)} | {difficulty.get('medium_easy', 0)} | {difficulty.get('medium_hard', 0)} | {difficulty.get('hard', 0)} | {conditions} |")
        lines.append("")
    (AUDIT / "README.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUTPUT_JSON}")
    print(f"Wrote audit artifacts to {AUDIT}")


if __name__ == "__main__":
    main()
