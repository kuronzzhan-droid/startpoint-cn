"""P0c helpers: preserve read-only inputs and confine outputs to build-p0c."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

ROOT = Path(__file__).resolve().parents[1]
P0 = ROOT.parent
P13 = Path(r'<WORKDIR>\outputs\work\beretta-p13-20261025')
BASE = ROOT / 'inputs/v35abyss-p13-local.swf'
FINAL = ROOT / 'swf/boot-riven-p0c.swf'
P12 = P0 / 'build/client/build/v35abyss-p12b-local.swf'
P0A = P0 / 'build/client/build/riven-p0a-local.swf'
P0B = P0 / 'build-p0b/swf/boot-riven-p0b.swf'
BASE_SHA = '2d748efba919fee44ecf149a02cb87cb703ecc5e365fcf64d44b8f0fbd6a0540'
APK_SHA = '51672dd80d3e277e9570e78b7ae948559dae781d216898fce1c95a63d8e687ca'
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
    path = Path(path)
    if not path.resolve().is_relative_to(ROOT.resolve()):
        raise ValueError(f'Output escaped P0c: {path}')
    path.parent.mkdir(parents=True, exist_ok=True)
    for ancestor in (path.parent, *path.parent.parents):
        attrs = getattr(ancestor.stat(follow_symlinks=False), 'st_file_attributes', 0)
        if attrs & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise ValueError(f'Output path contains junction/symlink: {ancestor}')
    return path


def write_json(path, value):
    output_path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', 'utf-8')


def write_immutable(path, data):
    path = output_path(path)
    if path.exists() and path.read_bytes() != data:
        raise FileExistsError(f'Refusing to replace different content: {path}')
    if not path.exists():
        path.write_bytes(data)

