#!/usr/bin/env python3
"""Install a patched WF APK into MuMu instance N with the AIR SWF-cache refresh.

Why this exists (2026-09-07): the AIR runtime extracts
`assets/worldflipper_android_release.swf` into
`/data/data/com.leiting.wf/cache/app/<uuid>/assets/` on first launch and keeps
loading that copy. `pm install -r` replaces base.apk but never refreshes the
cache, so a patched APK silently keeps running the old SWF. V9..V11b were all
installed that way and none of them ever ran. Steps here:

  1. kill the game process (never `am force-stop`: it triggers a full asset re-download)
  2. `pm install -r` from the MuMu shared folder, read back base.apk sha256
  3. `rm -rf cache/app` and PROVE it is gone (rm failures are silent)
  4. `am start` the explicit Activity, wait, sha256 the re-extracted SWF and
     compare it with the SWF inside the APK we installed
  5. copy latest.log out and scan it for error codes

Only `cache/app` is touched. The asset ledger (`.../Local Store/asset`) and the
device identity files are never deleted.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

MUMU = Path(r"D:/WF/MuMuPlayer/nx_main/MuMuManager.exe")
SHARED_HOST = Path(r"C:/Users/12101/Documents/MuMu共享文件夹")
SHARED_DEV = "/mnt/shared/MuMuShared"
PKG = "com.leiting.wf"
ACTIVITY = "com.leiting.wf/air.com.leiting.wf.AppEntry"
CACHE = f"/data/data/{PKG}/cache/app"
LATEST_LOG = f"/data/data/{PKG}/{PKG}/Local Store/custom_Release_Android/latest.log"
SWF_MEMBER = "assets/worldflipper_android_release.swf"


def sh(vm: int, cmd: str, timeout: int = 180) -> str:
    proc = subprocess.run([str(MUMU), "sh", "-v", str(vm), "-c", cmd],
                          capture_output=True, text=True, errors="replace", timeout=timeout)
    return (proc.stdout or "") + (proc.stderr or "")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def apk_swf_sha256(apk: Path) -> str:
    with zipfile.ZipFile(apk) as z:
        return hashlib.sha256(z.read(SWF_MEMBER)).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("apk", type=Path)
    ap.add_argument("--vm", type=int, default=1)
    ap.add_argument("--wait", type=int, default=45, help="seconds to wait after am start")
    ap.add_argument("--no-launch", action="store_true")
    args = ap.parse_args()
    apk = args.apk.resolve(strict=True)
    report: dict = {"apk": str(apk), "apk_sha256": sha256_file(apk), "apk_swf_sha256": apk_swf_sha256(apk)}

    staged = SHARED_HOST / apk.name
    if not staged.exists() or sha256_file(staged) != report["apk_sha256"]:
        shutil.copy2(apk, staged)
    report["staged"] = str(staged)

    pids = sh(args.vm, f"pidof {PKG}").strip()
    report["pids_before"] = pids
    if pids:
        sh(args.vm, f"kill -9 {pids}")
        time.sleep(2)

    out = sh(args.vm, f"pm install -r {SHARED_DEV}/{apk.name}", timeout=600)
    report["pm_install"] = out.strip()[-200:]
    if "Success" not in out:
        print(json.dumps(report, ensure_ascii=False, indent=1))
        print("FAIL: pm install did not report Success", file=sys.stderr)
        return 2

    base = sh(args.vm, f"sha256sum $(pm path {PKG} | sed s/package://) | cut -c1-64").strip().split()[-1]
    report["device_base_apk_sha256"] = base
    if base != report["apk_sha256"]:
        print(json.dumps(report, ensure_ascii=False, indent=1))
        print("FAIL: device base.apk hash != installed APK", file=sys.stderr)
        return 3

    sh(args.vm, f"rm -rf {CACHE}")
    gone = sh(args.vm, f"ls -d {CACHE} 2>&1").strip()
    report["cache_after_rm"] = gone
    if "No such file" not in gone:
        print(json.dumps(report, ensure_ascii=False, indent=1))
        print("FAIL: cache/app still present, refusing to continue", file=sys.stderr)
        return 4

    if args.no_launch:
        print(json.dumps(report, ensure_ascii=False, indent=1))
        return 0

    sh(args.vm, f"am start -n {ACTIVITY}")
    time.sleep(args.wait)
    report["pids_after"] = sh(args.vm, f"pidof {PKG}").strip()
    extracted = sh(args.vm, f"sha256sum {CACHE}/*/assets/worldflipper_android_release.swf 2>&1").strip()
    report["extracted_swf"] = extracted[:200]
    ok = extracted[:64] == report["apk_swf_sha256"]
    report["extracted_matches_apk"] = ok

    stamp = time.strftime("%H%M%S")
    sh(args.vm, f"cp '{LATEST_LOG}' /sdcard/Pictures/latest_install_{stamp}.log")
    time.sleep(2)
    log_host = SHARED_HOST / "Pictures" / f"latest_install_{stamp}.log"
    if log_host.exists():
        text = log_host.read_text(encoding="utf-8", errors="replace")
        report["log_lines"] = text.count("\n")
        report["log_error_hits"] = [line[:160] for line in text.splitlines() if '"code":"' in line or "stackTrace" in line][:5]
    print(json.dumps(report, ensure_ascii=False, indent=1))
    if not ok:
        print("FAIL: re-extracted SWF does not match the APK's SWF", file=sys.stderr)
        return 5
    return 0


if __name__ == "__main__":
    sys.exit(main())
