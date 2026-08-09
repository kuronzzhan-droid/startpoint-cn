#!/usr/bin/env python3
"""Verify FFDec-exported ActionScript against the Mode15 v20 client contract."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
DEFAULT_MANIFEST = HERE / "examples" / "mode15_client_routing.v20.json"


def class_path(scripts_root: Path, class_name: str) -> Path:
    return scripts_root / Path(*class_name.split(".")).with_suffix(".as")


def load_manifest(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != 1:
        raise ValueError(f"unsupported schema_version in {path}")
    return payload


def verify(scripts_root: Path, manifest: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    for entry in manifest["classes"]:
        class_name = entry["name"]
        source_path = class_path(scripts_root, class_name)
        if not source_path.is_file():
            errors.append(f"missing class export: {class_name} ({source_path})")
            continue
        source = source_path.read_text(encoding="utf-8-sig")
        for marker in entry.get("required_markers", []):
            if marker not in source:
                errors.append(f"{class_name}: required marker missing: {marker}")
        for marker, expected in entry.get("required_marker_counts", {}).items():
            actual = source.count(marker)
            if actual != expected:
                errors.append(
                    f"{class_name}: marker count mismatch: {marker!r}: "
                    f"expected {expected}, got {actual}"
                )
        for marker in entry.get("forbidden_markers", []):
            if marker in source:
                errors.append(f"{class_name}: forbidden marker present: {marker}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify a directory of FFDec-exported ActionScript files for Mode15 v20."
    )
    parser.add_argument(
        "scripts_root",
        type=Path,
        help="FFDec export root containing pinball/.../*.as",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=DEFAULT_MANIFEST,
        help=f"routing manifest (default: {DEFAULT_MANIFEST})",
    )
    args = parser.parse_args()

    if not args.scripts_root.is_dir():
        parser.error(f"scripts root not found: {args.scripts_root}")
    if not args.manifest.is_file():
        parser.error(f"manifest not found: {args.manifest}")

    errors = verify(args.scripts_root, load_manifest(args.manifest))
    if errors:
        print("Mode15 APK verification FAILED")
        for error in errors:
            print(f"- {error}")
        return 1

    print("Mode15 APK verification OK")
    print(f"- revision: {load_manifest(args.manifest)['final_revision']}")
    print(f"- scripts: {args.scripts_root.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
