"""Pure ABC helpers shared by the retained equipment fixtures."""
from pathlib import Path
import hashlib
import importlib.util
import sys
import types
CLIENT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(CLIENT / 'lens0907-0908'))
import build_swf as builder
spec = importlib.util.spec_from_file_location('equipment_fixture_swftags', CLIENT / 'pr43-port/support/swftags.py')
swftags = importlib.util.module_from_spec(spec)
spec.loader.exec_module(swftags)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def view(abc):
    return builder.View(types.SimpleNamespace(abc=abc), builder.asm)

def static_methods(abc, owner):
    at, = [i for i, row in enumerate(abc.instances) if abc.mn_name(row[0]) == owner]
    return {abc.mn_name(t.name).rsplit('::', 1)[-1]: t for t in abc.classes[at][1] if t.kind == 1}

def body_index(abc, mid):
    index, = [i for i, row in enumerate(abc.bodies) if row[0] == mid]
    return index
