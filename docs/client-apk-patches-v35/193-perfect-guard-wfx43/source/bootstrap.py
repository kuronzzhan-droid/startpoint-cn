"""Local, dependency-free environment and immutable input SWF identity."""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / "vendor"))

INPUT_SWF = ROOT / "input/riven-wt-1008092.swf"
INPUT_SHA256 = "39acc27b8126fc51450dcf5fab53a8c21d8d4b0cebd4a2384ed60617a3eee97d"
OUTPUT_SWF = ROOT / "build/guard-wt-1008092.swf"

INPUTS = {
    "wt": (INPUT_SWF, INPUT_SHA256),
}


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def output_path(path: Path | str) -> Path:
    """Create parent directory, refusing output outside this task workspace or into read-only dirs."""
    path = Path(path).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError(f"output outside task workspace: {path}")
    for immutable in ("input", "vendor-ref", "vendor"):
        if path.is_relative_to(ROOT / immutable):
            raise ValueError(f"{immutable} directory is immutable: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def verify_input(path: Path | str | None = None) -> Path:
    target = INPUT_SWF if path is None else Path(path).resolve()
    actual = sha(target.read_bytes())
    if target == INPUT_SWF.resolve() and actual != INPUT_SHA256:
        raise ValueError(f"unknown input SWF sha256: {actual}; expected {INPUT_SHA256}")
    return target


def build_path() -> Path:
    return OUTPUT_SWF
