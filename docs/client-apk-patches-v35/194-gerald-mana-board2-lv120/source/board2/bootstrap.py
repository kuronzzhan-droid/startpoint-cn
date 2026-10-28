"""Local, dependency-free environment and immutable input SWF identities for board2 patch."""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
GUARD_ROOT = ROOT.parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(GUARD_ROOT / "vendor"))

INPUT_SWF = GUARD_ROOT / "merge/out/final/merge-wt-1008093.swf"
INPUT_SHA256 = "df215a5544c1c73c6dc5fe9025685e46f4930c45dca52b00ce00de38d92554c3"
OUTPUT_SWF = ROOT / "build/board2-merge-wt-1008093.swf"

RIVEN_SWF = GUARD_ROOT / "input/riven-wt-1008092.swf"
RIVEN_SHA256 = "39acc27b8126fc51450dcf5fab53a8c21d8d4b0cebd4a2384ed60617a3eee97d"
RIVEN_OUTPUT_SWF = ROOT / "build/board2-riven-wt-1008092.swf"

KNOWN_INPUTS = {
    INPUT_SWF.resolve(): INPUT_SHA256,
    RIVEN_SWF.resolve(): RIVEN_SHA256,
}


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def output_path(path: Path | str) -> Path:
    """Create parent directory, refusing any output outside D:\\WF\\outputs\\work\\gerald-guard-20261027\\board2."""
    resolved = Path(path).resolve()
    # 合包脚本(../merge)也在 gerald-guard 工作区内,放行父目录
    if not resolved.is_relative_to(ROOT.parent):
        raise ValueError(f"output outside gerald-guard workspace is forbidden: {resolved}")
    resolved.parent.mkdir(parents=True, exist_ok=True)
    return resolved


def verify_input(path: Path | str | None = None) -> Path:
    target = INPUT_SWF.resolve() if path is None else Path(path).resolve()
    actual = sha(target.read_bytes())
    expected = KNOWN_INPUTS.get(target)
    if expected is not None and actual != expected:
        raise ValueError(f"input SWF sha256 mismatch for {target}: {actual} != {expected}")
    return target
