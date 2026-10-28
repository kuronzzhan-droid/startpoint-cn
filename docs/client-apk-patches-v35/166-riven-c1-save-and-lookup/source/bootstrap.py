"""C1 paths and write guards; external baselines remain read-only."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parent
P0 = WORKSPACE.parent / 'p0'
BASE = ROOT / 'inputs/boot-riven-p0c.swf'
P13 = ROOT / 'inputs/v35abyss-p13-local.swf'
FINAL = ROOT / 'swf/boot-riven-p1c1.swf'
BASE_SHA = 'd4efa2f65c95e7cf91f398eef2477a3a8c76f57e11b2e4884a42d43f2dd11ebe'
P13_SHA = '2d748efba919fee44ecf149a02cb87cb703ecc5e365fcf64d44b8f0fbd6a0540'
sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
sys.path[:0] = [str(ROOT / 'source'), str(ROOT / 'source/vendor')]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require_hash(path, expected):
    actual = sha(Path(path).read_bytes())
    if actual != expected:
        raise ValueError(f'SHA256 mismatch: {path}: {actual}')
    return actual


def output_path(path):
    path = Path(path).absolute()
    if not path.resolve().is_relative_to(ROOT.resolve()):
        raise ValueError(f'Output escaped C1 build: {path}')
    for ancestor in (path, *path.parents):
        if ancestor.exists():
            attrs = getattr(ancestor.lstat(), 'st_file_attributes', 0)
            if ancestor.is_symlink() or attrs & stat.FILE_ATTRIBUTE_REPARSE_POINT:
                raise ValueError(f'Output path contains junction/symlink: {ancestor}')
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def write_json(path, value):
    output_path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', 'utf-8')


def write_immutable(path, data):
    path = output_path(path)
    if path.exists() and path.read_bytes() != data:
        raise FileExistsError(f'Refusing to replace sealed content: {path}')
    if not path.exists():
        path.write_bytes(data)
