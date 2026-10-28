"""Package the merged SWF on 1008091 test APKs; refresh is the final APK mutation."""
import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PACKAGING = ROOT / "packaging"
sys.path.insert(0, str(PACKAGING))
from apk_audit import compare, identity
from nocache.apk_nocache import refresh

BASE = Path("<WORKDIR>/outputs/apk/continue-cost-20261026")
AUDIT = ROOT / "audit/apk"
OUTPUT = ROOT / "client-1008092"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline-only", action="store_true")
    parser.add_argument("--swf", type=Path, default=ROOT / "build/riven-wt-1008092.swf")
    args = parser.parse_args()
    tmp = PACKAGING / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    for name in ("TEMP", "TMP", "TMPDIR"):
        os.environ[name] = str(tmp)
    AUDIT.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    records = []
    for abi in ("x86", "arm64"):
        base = BASE / f"contcost-p13c-wt-{abi}.signed.apk"
        audit_dir = AUDIT / abi
        before = identity(base, audit_dir / "base")
        assert before["abi"] == ({"x86": ["arm64-v8a", "x86_64"], "arm64": ["arm64-v8a"]}[abi])
        assert before["package"] == "com.leiting.wt" and before["version_code"] == 1008091
        record = {"abi": abi, "base": before}
        if not args.baseline_only:
            assert args.swf.is_file(), args.swf
            out = OUTPUT / f"riven-wt-1008092-{abi}.signed.apk"
            result = refresh(base, out, version_code=1008092, swf_bytes=args.swf.read_bytes())
            # Source tool's build_id means cache identity, not SWF admission build ID.
            result["startupcache_build_identity"] = result.pop("build_id")
            after = identity(out, audit_dir / "output")
            record.update(output=after, refresh=result,
                          comparison=compare(base, out, args.swf, before, after, audit_dir))
        records.append(record)
        print(json.dumps({"abi": abi, "mode": "baseline" if args.baseline_only else "packaged", "base_sha256": before["sha256"],
                          "output_sha256": record.get("output", {}).get("sha256")}, ensure_ascii=False), flush=True)
    assert records[0]["base"]["swf_sha256"] == records[1]["base"]["swf_sha256"]
    name = "base-identity.json" if args.baseline_only else "pack-report.json"
    (AUDIT / name).write_text(json.dumps(records, ensure_ascii=False, indent=2), "utf-8")
    if not args.baseline_only:
        assert records[0]["output"]["swf_sha256"] == records[1]["output"]["swf_sha256"]
        (OUTPUT / "SHA256SUMS.txt").write_text("".join(f'{r["output"]["sha256"]}  {Path(r["output"]["path"]).name}\n' for r in records), "utf-8")


if __name__ == "__main__":
    main()
