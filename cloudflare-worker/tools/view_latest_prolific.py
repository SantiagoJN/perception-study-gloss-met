#!/usr/bin/env python3
"""Open the newest D1 study export stored in the Prolific backup folder."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from view_d1_export import ExportViewer, load_export, print_summary


PROLIFIC_BACKUP_DIRECTORY = Path(r"Y:\VLM-user-study-results\prolific")


def newest_export() -> Path:
    if not PROLIFIC_BACKUP_DIRECTORY.is_dir():
        raise FileNotFoundError(
            f"The Prolific backup folder is unavailable: {PROLIFIC_BACKUP_DIRECTORY}"
        )
    exports = [path for path in PROLIFIC_BACKUP_DIRECTORY.glob("*.sql") if path.is_file()]
    if not exports:
        raise FileNotFoundError(
            f"No .sql exports were found in {PROLIFIC_BACKUP_DIRECTORY}"
        )
    return max(exports, key=lambda path: path.stat().st_mtime)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--summary",
        action="store_true",
        help="print table row counts instead of opening the graphical viewer",
    )
    arguments = parser.parse_args()

    try:
        export = newest_export()
    except OSError as error:
        print(error, file=sys.stderr)
        return 1

    if arguments.summary:
        try:
            connection = load_export(export)
            print_summary(export, connection)
            connection.close()
        except Exception as error:
            print(f"Could not read {export}: {error}", file=sys.stderr)
            return 1
        return 0

    try:
        import tkinter as tk
    except ImportError:
        print(
            "Tkinter is not installed. Run with --summary, install python3-tk, "
            "or open the graphical viewer on Windows.",
            file=sys.stderr,
        )
        return 1

    root = tk.Tk()
    ExportViewer(root, export, page_size=100)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
