"""把 O8/O9 重放到任一 SWF（同原方法体即打，已打即跳过，其他一律拒绝）。
usage: python apply.py IN.swf OUT.swf [--report report.json]"""
import json, sys
from pathlib import Path
sys.path.insert(0, r"D:/WF/perf-v30-20261015/tools"); sys.path.insert(0, str(Path(__file__).resolve().parent))
from perf2_core import Refused, apply_patches
from v34_patches import PATCHES
a = sys.argv[1:]
rep = None
if "--report" in a:
    i = a.index("--report"); rep = Path(a[i + 1]); del a[i:i + 2]
src, dst = Path(a[0]), Path(a[1])
assert src.resolve() != dst.resolve()
try:
    out, report = apply_patches(src.read_bytes(), PATCHES, select=set(a[2:]) or None)
except Refused as e:
    raise SystemExit(f"REFUSED: {e}")
dst.write_bytes(out)
if rep: rep.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
for p in report["patches"]: print(p["id"], p["status"], p["label"], p.get("after"))
print("output", report["output_swf_sha256"])
