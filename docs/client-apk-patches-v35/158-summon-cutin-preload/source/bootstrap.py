"""P12 锁定构建环境；输入只读，所有输出限定在当前工作目录。"""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

ROOT = Path(__file__).resolve().parents[1]
TASK = ROOT.parent.parent / 'abyss-beast-rework-20261025'
P11 = TASK / 'p11'
LEADER = ROOT.parent.parent / 'leader-kind-patch-20261025'
sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
sys.path[:0] = [str(ROOT / 'source'), str(ROOT / 'source/vendor'),
               str(TASK / 'client/vendor'), str(TASK / 'client'), str(LEADER)]


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
        raise ValueError(f'Output escaped P12: {path}')
    path.parent.mkdir(parents=True, exist_ok=True)
    for ancestor in (path.parent, *path.parent.parents):
        attrs = getattr(ancestor.stat(follow_symlinks=False), 'st_file_attributes', 0)
        if attrs & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise ValueError(f'Output path contains junction/symlink: {ancestor}')
    return path


def load_lock():
    lock = json.loads((ROOT / 'build-lock.json').read_text('utf-8'))
    for source in lock['source_files']:
        require_hash(source['path'], source['sha256'])
    return lock


def write_json(path, value):
    output_path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', 'utf-8')
