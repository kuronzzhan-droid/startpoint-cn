"""Local build environment for the leader-table kind patch."""
import hashlib, os, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / 'vendor'))
INPUTS = {'p8': (ROOT / 'input/p8-wt.swf', '5f96c12e0f9c5059907894896a67d9e30b834006b34876752e8d57c7cd45ddef')}
def sha(raw): return hashlib.sha256(raw).hexdigest()
def output_path(path):
    path = Path(path).resolve(); path.parent.mkdir(parents=True, exist_ok=True); return path
