#!/usr/bin/env python3
"""Serve the built study and local dataset renders from one restricted origin."""

from __future__ import annotations

import argparse
import csv
import mimetypes
import shutil
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DIST = HERE / "dist"


def dataset_render_root(version: str) -> Path:
    """Return current storage while preserving legacy public render URLs."""
    dataset = ROOT / version
    candidates = (
        (dataset / "renders_testing", dataset / "renders")
        if version == "datasetv9"
        else (dataset / "renders",)
    )
    return next(
        (candidate for candidate in candidates if candidate.is_dir()),
        candidates[0],
    )


RENDER_ROOTS = {
    version: dataset_render_root(version)
    for version in ("datasetv6", "datasetv7", "datasetv9")
}
mimetypes.add_type("image/webp", ".webp")
PRIVATE_MAPPING = HERE / "private/deployment/cloudflare_name_mapping.csv"


def load_local_stimuli() -> dict[str, Path]:
    if not PRIVATE_MAPPING.is_file():
        return {}
    with PRIVATE_MAPPING.open(newline="", encoding="utf-8") as stream:
        rows = csv.DictReader(stream)
        return {
            row["cloudflare_object_filename"]: ROOT / "datasetv7/renders" / row["original_filename"]
            for row in rows
        }


LOCAL_STIMULI = load_local_stimuli()


def contained(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


class StudyHandler(SimpleHTTPRequestHandler):
    server_version = "MaterialConstancyStudy/1.0"

    def resolve(self) -> Path | None:
        request_path = unquote(urlsplit(self.path).path)
        if request_path.startswith("/stimuli/"):
            object_name = request_path[len("/stimuli/"):]
            if "/" in object_name or "\\" in object_name:
                return None
            candidate = LOCAL_STIMULI.get(object_name)
            return candidate.resolve() if candidate and candidate.is_file() else None
        for dataset, render_root in RENDER_ROOTS.items():
            render_prefix = f"/{dataset}/renders/"
            if request_path.startswith(render_prefix):
                relative = request_path[len(render_prefix):]
                candidate = (render_root / relative).resolve()
                return candidate if contained(candidate, render_root.resolve()) else None
        groups4_prefix = "/datasetv9/groups4/"
        if request_path.startswith(groups4_prefix):
            groups4_root = (ROOT / "datasetv9/groups4").resolve()
            relative = request_path[len(groups4_prefix):]
            candidate = (groups4_root / relative).resolve()
            return candidate if contained(candidate, groups4_root) else None
        relative = request_path.lstrip("/")
        candidate = (DIST / relative).resolve()
        if not contained(candidate, DIST.resolve()):
            return None
        if candidate.is_dir():
            candidate /= "index.html"
        if not candidate.exists() and "." not in Path(relative).name:
            candidate = DIST / "index.html"
        return candidate

    def send_file(self, include_body: bool) -> None:
        target = self.resolve()
        if target is None or not target.is_file():
            self.send_error(404)
            return
        try:
            size = target.stat().st_size
            source = target.open("rb") if include_body else None
        except OSError:
            self.send_error(500)
            return
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "no-cache" if target.suffix in {".html", ".json"} else "public, max-age=86400")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("X-Robots-Tag", "noindex, nofollow")
        self.end_headers()
        if source is not None:
            try:
                with source:
                    shutil.copyfileobj(source, self.wfile, length=1024 * 1024)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def do_GET(self) -> None:
        self.send_file(True)

    def do_HEAD(self) -> None:
        self.send_file(False)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8020)
    args = parser.parse_args()
    if not (DIST / "index.html").is_file():
        raise SystemExit("dist/index.html is missing; run npm run build first")
    server = ThreadingHTTPServer((args.host, args.port), StudyHandler)
    print(f"Study available at http://{args.host}:{args.port}/", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
