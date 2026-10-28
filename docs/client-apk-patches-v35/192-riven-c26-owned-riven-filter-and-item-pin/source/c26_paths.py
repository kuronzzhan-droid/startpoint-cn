"""C26 paths (self-contained; external inputs are read-only)."""
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
ROOT = Path(__file__).resolve().parents[1]          # round2/c26
ROUND2 = ROOT.parent                                 # round2
WORK = ROUND2.parent                                 # weapon-riven-20261025
sys.path[:0] = [str(ROOT / 'source'), str(ROOT / 'source/vendor')]
