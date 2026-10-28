"""Local, dependency-free environment and immutable p13 input identities."""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / "vendor"))

INPUTS = {
    "test": (
        ROOT / "input/p13-wt-x86.swf",
        "9f46bd7458a6ff5297e881d3a1acb49a315c23821c851b504abfd1a4a0a3a458",
    ),
    "local": (
        ROOT / "input/p13-local-wf-x86.swf",
        "2d748efba919fee44ecf149a02cb87cb703ecc5e365fcf64d44b8f0fbd6a0540",
    ),
}


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def output_path(path: Path | str) -> Path:
    """Create a parent directory, refusing output outside this task workspace."""
    path = Path(path).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError(f"output outside task workspace: {path}")
    if path.is_relative_to(ROOT / "input"):
        raise ValueError(f"input directory is immutable: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def verify_input(profile: str) -> Path:
    path, expected = INPUTS[profile]
    actual = sha(path.read_bytes())
    if actual != expected:
        raise ValueError(f"unknown {profile} input: {actual}; expected {expected}")
    return path


def build_path(profile: str) -> Path:
    suffix = "wt" if profile == "test" else "local-wf"
    return ROOT / "build" / f"p13-{suffix}-x86-stage-carry.swf"
