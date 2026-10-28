"""Task-local imports and immutable p13s input identities."""
from __future__ import annotations
import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / 'vendor'))
INPUTS = {
    'test': (ROOT / 'input/p13s-wt.swf', 'bdd70af88170c12b35eab019054b2096bbfbbedd998536483fcc9c70e6b2ee4e'),
    'local': (ROOT / 'input/p13s-local-wf.swf', 'ae820fcc7cf32674b80ee4dec38253f698e6f20523b3ebe4e528d2dc8fdcfa21'),
}

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def output_path(path):
    path = Path(path).resolve()
    if not path.is_relative_to(ROOT) or any(path.is_relative_to(ROOT / p) for p in ('input', 'vendor', 'vm')):
        raise ValueError('write outside permitted output: ' + str(path))
    path.parent.mkdir(parents=True, exist_ok=True)
    return path

def verify_input(profile):
    path, expected = INPUTS[profile]
    if sha(path.read_bytes()) != expected:
        raise ValueError('input SHA256 mismatch: ' + profile)
    return path

def build_path(profile):
    return ROOT / 'build' / ('p13s-' + ('wt' if profile == 'test' else 'local-wf') + '-continue-cost.swf')
