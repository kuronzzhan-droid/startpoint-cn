"""Convert the accepted LAN Boss APK to the public endpoint.

The Boss SWF is treated as the already-tested LAN input. This step performs
only the public endpoint rewrite, AIR cache UUID refresh, APK signing and
readback checks; it does not recompile or alter Boss ActionScript methods.
Admission constants in the input SWF are preserved byte-for-byte.
"""
from __future__ import annotations

import hashlib
import importlib.util
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PACKAGER = ROOT / "client-patch/author-content-1043/package_android.py"
INPUT_APK = Path(os.environ.get(
    "STARPOINT_BOSS_LAN_APK",
    r"F:/codex/outputs/orochi-boss-v2-1047-20260925/android/"
    r"StarPoint-CN-1.8.1-author-1047-orochi-balance-f1034-fix-lan-20260925.apk",
))
INPUT_SWF = Path(os.environ.get(
    "STARPOINT_BOSS_LAN_SWF",
    r"F:/codex/work/orochi-boss-v2-1047-20260925/balance-revamp-20260925/"
    r"orochi-balance-ledger-f1034-fixed-v2.swf",
))
WORK = Path(os.environ.get(
    "STARPOINT_BOSS_ANDROID_WORK",
    r"F:/codex/work/client-public-20260926/build/android",
))
OUTPUT = Path(os.environ.get(
    "STARPOINT_BOSS_ANDROID_OUT",
    r"F:/codex/outputs/orochi-boss-public-20260926/android",
))
PUBLIC_HOST = "TEST-SERVER-HOST"
LAN_HOST = os.environ.get("STARPOINT_BOSS_LAN_HOST")
EXPECTED_APK_SHA = "31bf5278ffc4a9834b7cf74b98b6312098708a433fddba364e075fca40c39aab"
EXPECTED_SWF_SHA = "689e04482b204c6ae428448fa531b41cbde659fd91b3384f3e6a6cf8d2ba70e2"
EXPECTED_UUID = "1afec300-308c-40b7-be24-bb8354ff2777"


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path: Path):
    spec = importlib.util.spec_from_file_location("boss_android_packager", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    if not LAN_HOST:
        raise RuntimeError("set STARPOINT_BOSS_LAN_HOST to the accepted LAN endpoint")
    if sha(INPUT_APK) != EXPECTED_APK_SHA:
        raise RuntimeError("LAN APK hash changed; update the accepted input record first")
    if sha(INPUT_SWF) != EXPECTED_SWF_SHA:
        raise RuntimeError("Boss SWF hash changed; update the accepted input record first")
    packager = load(PACKAGER)
    packager.BASE_APK = INPUT_APK
    packager.BASE_SHA = EXPECTED_APK_SHA
    packager.BASE_SWF = EXPECTED_SWF_SHA
    packager.OLD_UUID = EXPECTED_UUID
    packager.OLD_HOST = LAN_HOST
    packager.LAN_HOST = PUBLIC_HOST
    packager.ADMISSION_ID = "android-181-author-1047-20260925"
    packager.main(
        INPUT_SWF,
        WORK,
        OUTPUT,
        expected_swf=EXPECTED_SWF_SHA,
        label="author-1047-orochi-boss-public",
    )


if __name__ == "__main__":
    main()
