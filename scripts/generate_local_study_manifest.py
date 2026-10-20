#!/usr/bin/env python3
"""Export the selected v2 pair pool without exposing physical labels."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd


HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent
ROOT = PROJECT.parent
SOURCE = ROOT / "mining_pairs_v2/selection/pairs_selected.parquet"
OUTPUT = PROJECT / "public/study_pairs.json"


def main() -> None:
    pairs = pd.read_parquet(SOURCE)
    grouped = list(pairs.groupby(["physical_type", "provisional_level"], sort=True))
    counts = {str(key): len(group) for key, group in grouped}
    if len(pairs) != 2400 or len(grouped) != 8 or set(counts.values()) != {300}:
        raise RuntimeError(f"Unexpected v2 selection: {counts}")
    records = [
        {
            "pair_id": row.pair_id,
            "image_path_a": row.image_path_a,
            "image_path_b": row.image_path_b,
            "stratum": f"S{index:02d}",
        }
        for index, (_, group) in enumerate(grouped, start=1)
        for row in group.itertuples(index=False)
    ]
    OUTPUT.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(records)} balanced pairs to {OUTPUT}")


if __name__ == "__main__":
    main()
