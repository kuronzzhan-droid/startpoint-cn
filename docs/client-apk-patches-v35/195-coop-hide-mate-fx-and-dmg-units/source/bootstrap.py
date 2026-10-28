"""Local, dependency-free environment and immutable input SWF identity."""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / "vendor-ref"))

DEFAULT_INPUT = ROOT / "input" / "riven-wt-1008092.swf"
DEFAULT_INPUT_SHA256 = "39acc27b8126fc51450dcf5fab53a8c21d8d4b0cebd4a2384ed60617a3eee97d"
DEFAULT_OUTPUT = ROOT / "build" / "matefx-wt-1008092.swf"

INPUTS = {
    "wt-1008092": (DEFAULT_INPUT, DEFAULT_INPUT_SHA256),
}


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def output_path(path: Path | str) -> Path:
    """Create parent directory, refusing output outside this task workspace or inside input/."""
    resolved = Path(path).resolve()
    if not resolved.is_relative_to(ROOT):
        raise ValueError(f"output outside task workspace: {resolved}")
    if resolved.is_relative_to(ROOT / "input"):
        raise ValueError(f"input directory is immutable: {resolved}")
    resolved.parent.mkdir(parents=True, exist_ok=True)
    return resolved


def verify_default_input() -> Path:
    actual = sha(DEFAULT_INPUT.read_bytes())
    if actual != DEFAULT_INPUT_SHA256:
        raise ValueError(f"default input sha256 mismatch: {actual}; expected {DEFAULT_INPUT_SHA256}")
    return DEFAULT_INPUT
