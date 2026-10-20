#!/usr/bin/env python3
"""Reject unsafe participant-facing deployment configuration."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import parse_qs, urlparse


PUBLIC = Path(__file__).resolve().parents[1] / "public"
TEST_KEYS = {f"test{index}" for index in range(1, 5)}


def entries(filename: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for raw_line in (PUBLIC / filename).read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        assert separator and key.strip() and value.strip(), f"Malformed {filename} line: {raw_line!r}"
        result[key.strip()] = value.strip()
    assert set(result) == TEST_KEYS, f"{filename} must define exactly test1..test4"
    return result


def main() -> None:
    for outcome in ("completion", "screen_out"):
        codes = entries(f"{outcome}_codes.txt")
        redirects = entries(f"{outcome}_redirects.txt")
        for key in sorted(TEST_KEYS):
            code = codes[key]
            destination = redirects[key]
            assert "REPLACE_" not in code.upper(), f"Placeholder {outcome} code for {key}"
            parsed = urlparse(destination)
            assert parsed.scheme == "https" and parsed.netloc, f"Invalid {outcome} redirect for {key}"
            redirect_code = parse_qs(parsed.query).get("cc", [""])[0]
            assert redirect_code == code, f"{outcome} redirect/code mismatch for {key}"
    print("Deployment configuration valid: four completion and four screen-out destinations.")


if __name__ == "__main__":
    main()
