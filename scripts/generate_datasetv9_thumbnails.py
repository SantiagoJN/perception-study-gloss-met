#!/usr/bin/env python3
"""Generate the participant-facing dataset v9 thumbnails.

The square material renders are reduced to 512 x 512.  Test 3 composites use
a common 256 px height, preserving their native 3:1 and 4.5:1 aspect ratios.
Original PNG files remain untouched and are used by the study zoom view.
"""

from __future__ import annotations

import argparse
import os
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from PIL import Image


PROJECT = Path(__file__).resolve().parents[1]
DATASET = PROJECT.parent / "datasetv9"


@dataclass(frozen=True)
class ThumbnailSet:
    source: Path
    destination: Path
    mode: str


SETS = (
    ThumbnailSet(DATASET / "renders_testing", DATASET / "thumbnails", "square"),
    ThumbnailSet(DATASET / "groups4/renders3", DATASET / "groups4/thumbnails", "scene"),
    ThumbnailSet(DATASET / "groups4/sentinels", DATASET / "groups4/sentinels_thumbnails", "scene"),
)


def target_size(source_size: tuple[int, int], mode: str) -> tuple[int, int]:
    width, height = source_size
    if mode == "square":
        if source_size != (1024, 1024):
            raise ValueError(f"Expected a 1024 x 1024 render, found {width} x {height}")
        return 512, 512
    if height <= 0:
        raise ValueError(f"Invalid source dimensions: {width} x {height}")
    scaled_width = round(width * 256 / height)
    return scaled_width, 256


def generate_one(task: tuple[str, str, str, bool]) -> tuple[str, tuple[int, int], bool]:
    source_value, destination_value, mode, force = task
    source = Path(source_value)
    destination = Path(destination_value)
    with Image.open(source) as image:
        image.load()
        size = target_size(image.size, mode)
        expected_mtime = source.stat().st_mtime
        if not force and destination.is_file() and destination.stat().st_mtime >= expected_mtime:
            try:
                with Image.open(destination) as existing:
                    existing_size = existing.size
                    existing.verify()
                if existing_size == size:
                    return destination_value, size, False
            except (OSError, ValueError):
                pass
        resampling = getattr(Image, "Resampling", Image).LANCZOS
        thumbnail = image.convert("RGB").resize(size, resampling)
        destination.parent.mkdir(parents=True, exist_ok=True)
        thumbnail.save(destination, "WEBP", lossless=True, method=6)
    os.utime(destination, (expected_mtime, expected_mtime))
    return destination_value, size, True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="Regenerate existing up-to-date files.")
    parser.add_argument(
        "--workers",
        type=int,
        default=min(32, os.cpu_count() or 1),
        help="Parallel worker count (default: up to 32).",
    )
    args = parser.parse_args()
    if args.workers < 1:
        parser.error("--workers must be at least 1")

    tasks: list[tuple[str, str, str, bool]] = []
    expected_counts: dict[Path, int] = {}
    for thumbnail_set in SETS:
        if not thumbnail_set.source.is_dir():
            raise SystemExit(f"Missing source directory: {thumbnail_set.source}")
        sources = sorted(thumbnail_set.source.glob("*.png"))
        if not sources:
            raise SystemExit(f"No PNG files found in: {thumbnail_set.source}")
        thumbnail_set.destination.mkdir(parents=True, exist_ok=True)
        expected_counts[thumbnail_set.destination] = len(sources)
        tasks.extend(
            (
                str(source),
                str(thumbnail_set.destination / f"{source.stem}.webp"),
                thumbnail_set.mode,
                args.force,
            )
            for source in sources
        )

    generated = 0
    sizes: dict[tuple[int, int], int] = {}
    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        for _, size, changed in executor.map(generate_one, tasks, chunksize=8):
            generated += int(changed)
            sizes[size] = sizes.get(size, 0) + 1

    for destination, expected in expected_counts.items():
        actual = len(list(destination.glob("*.webp")))
        if actual != expected:
            raise SystemExit(f"Unexpected thumbnail count in {destination}: {actual} != {expected}")

    print(f"Processed {len(tasks)} thumbnails ({generated} generated, {len(tasks) - generated} current).")
    for size, count in sorted(sizes.items()):
        print(f"  {size[0]}x{size[1]}: {count}")
    for destination, expected in expected_counts.items():
        print(f"  {destination}: {expected} files")


if __name__ == "__main__":
    main()
