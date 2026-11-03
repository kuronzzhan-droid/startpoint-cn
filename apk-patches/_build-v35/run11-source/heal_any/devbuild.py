"""仅在heal_any内写离线候选，所有输入只读。"""
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import bootstrap
from framework import Editor, sha
from heal_any.patches import build, LOCKS

def main():
    assert sha(bootstrap.BASE.read_bytes()) == bootstrap.BASE_SHA
    e = Editor(bootstrap.BASE, locks=LOCKS)
    build(e)
    e.apply()
    raw = e.swf.write(e.abc) if hasattr(e.swf, 'write') else None
    if raw is None:
        from multiabc import compose
        raw = compose(e)
    path = ROOT/'heal_any'/'candidate.swf'
    path.write_bytes(raw)
    print(path, sha(raw))

if __name__ == '__main__':
    main()
