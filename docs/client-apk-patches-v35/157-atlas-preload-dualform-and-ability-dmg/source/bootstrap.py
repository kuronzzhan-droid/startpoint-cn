"""p11 output boundary and read-only reuse of the leader-kind build toolchain."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
TOOLCHAIN = ROOT.parent.parent / 'leader-kind-patch-20261025'
P10 = ROOT.parent.parent / 'abyss-beast-rework-20261025/p10'
spec = importlib.util.spec_from_file_location('leader_bootstrap', TOOLCHAIN / 'bootstrap.py')
leader_bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(leader_bootstrap)
INPUTS = {
    'test': (P10 / 'client/build/v35abyss-p10-test.swf',
             '4b96b8403a8d2ea1c4ccde45b7e36ba993bacdef47228b68459e2c32d30dda3e'),
    'local': (P10 / 'client/build/v35abyss-p10-local.swf',
              '4455d5617ecaf6caf2f157332b59b402dde749241339955823db20d8541b8d4a'),
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def output_path(path):
    path = Path(path).resolve()
    path.relative_to(ROOT)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def write_json(path, value):
    output_path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', 'utf-8')


def load_lock():
    lock = json.loads((ROOT / 'build-lock.json').read_text('utf-8'))
    for row in lock['source_files']:
        if sha(Path(row['path']).read_bytes()) != row['sha256']:
            raise RuntimeError('build source lock mismatch: ' + row['path'])
    for profile, (path, expected) in INPUTS.items():
        row = lock['profiles'][profile]
        if row != {'swf': str(path), 'swf_sha256': expected} or sha(path.read_bytes()) != expected:
            raise RuntimeError('p10 input lock mismatch: ' + profile)
    return lock
