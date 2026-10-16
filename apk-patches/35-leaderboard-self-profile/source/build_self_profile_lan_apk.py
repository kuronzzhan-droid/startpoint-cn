#!/usr/bin/env python3
"""Build the LAN APK with a native self-profile route for leaderboard clicks."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import uuid
from pathlib import Path


BASE_APK_SHA256 = "2e5101ceaa3e5e8e8ee8bf165f0cb81dd7649ac0cb8b276b2a8738c1e2628927"
BASE_SWF_SHA256 = "97c6c3d85ea9cc1b25a1d020f797b288e5e50685fe7675d1728ae5ca1e690cc8"
BASE_UUID = "ee327899-3f2b-4448-9e2d-da16ad13699a"


class BuildError(RuntimeError):
    pass


def load_navigation_builder():
    path = Path(__file__).with_name("build_navigation_apk.py")
    spec = importlib.util.spec_from_file_location("rush_navigation_builder", path)
    if spec is None or spec.loader is None:
        raise BuildError(f"cannot load navigation builder: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def patch_copy(text: str) -> str:
    old = "\n".join([
        '            findpropstrict QName(PackageNamespace(""),"changeSceneWithLoading")',
        '            getlex QName(PackageNamespace("pinball.common.data.scene"),"LoadingTaskKind")',
        "            getlocal1",
        '            getproperty QName(PackageNamespace(""),"id")',
        "            convert_d",
        '            callproperty QName(PackageNamespace(""),"ProfileGetProfile"), 1',
        '            getlex QName(PackageNamespace("pinball.common.data.scene"),"ChangeSceneBackKind")',
        '            getproperty QName(PackageNamespace(""),"AddCurrent")',
        '            callpropvoid QName(PackageNamespace(""),"changeSceneWithLoading"), 2',
        "            returnvoid",
    ])
    new = "\n".join([
        '            getlex QName(PackageNamespace(""),"globalLogic")',
        '            callproperty QName(PackageNamespace(""),"getPlayer"), 0',
        '            callproperty QName(PackageNamespace(""),"get_viewerId"), 0',
        "            convert_d",
        "            getlocal1",
        '            getproperty QName(PackageNamespace(""),"id")',
        "            convert_d",
        "            ifne ofs1050",
        '            findpropstrict QName(PackageNamespace(""),"changeSceneWithLoading")',
        '            getlex QName(PackageNamespace("pinball.common.data.scene"),"LoadingTaskKind")',
        '            getproperty QName(PackageNamespace(""),"ProfileGetMyProfile")',
        '            getlex QName(PackageNamespace("pinball.common.data.scene"),"ChangeSceneBackKind")',
        '            getproperty QName(PackageNamespace(""),"AddCurrent")',
        '            callpropvoid QName(PackageNamespace(""),"changeSceneWithLoading"), 2',
        "            returnvoid",
        "   ofs1050:",
        '            findpropstrict QName(PackageNamespace(""),"changeSceneWithLoading")',
        '            getlex QName(PackageNamespace("pinball.common.data.scene"),"LoadingTaskKind")',
        "            getlocal1",
        '            getproperty QName(PackageNamespace(""),"id")',
        "            convert_d",
        '            callproperty QName(PackageNamespace(""),"ProfileGetProfile"), 1',
        '            getlex QName(PackageNamespace("pinball.common.data.scene"),"ChangeSceneBackKind")',
        '            getproperty QName(PackageNamespace(""),"AddCurrent")',
        '            callpropvoid QName(PackageNamespace(""),"changeSceneWithLoading"), 2',
        "            returnvoid",
    ])
    if text.count(old) != 1:
        raise BuildError("existing ProfileGetProfile row route is not present exactly once")
    return text.replace(old, new, 1)


def build_swf(nav, work: Path, java: Path, ffdec: Path):
    root = work / "baseline-pcode"
    nav.run([
        java, "-Xmx4g", "-jar", ffdec, "-onerror", "abort", "-format", "script:pcode",
        "-selectclass", nav.TARGET_CLASS, "-export", "script", root, work / "baseline.swf",
    ])
    full = root / "scripts/pinball/scene/event/rush/ranking/party/RushEventRankingPartyScene.pcode"
    if not full.is_file():
        raise BuildError(f"FFDec did not export {full}")
    copy_pcode = patch_copy(nav.extract_method_pcode(full, "copyPlayedParty"))
    copy_path = work / "copyPlayedParty-self-profile.pcode"
    copy_path.write_text(copy_pcode, encoding="utf-8", newline="\n")
    locations = nav.locate_methods(work, java, ffdec)
    candidate = work / "self-profile-navigation.swf"
    nav.run([
        java, "-Xmx4g", "-jar", ffdec, "-air", "-onerror", "abort", "-replace",
        work / "baseline.swf", candidate, nav.TARGET_CLASS, copy_path,
        str(locations[f"{nav.TARGET_CLASS}.copyPlayedParty"][1]),
    ])
    tools = work / "method-tools"
    comparison = nav.run([
        java, "-cp", f"{tools}{os.pathsep}{ffdec}", "CompareMethodBodies",
        work / "baseline.swf", candidate,
    ], capture=True, timeout=300)
    if "changed_count=1" not in comparison or "changed=284:71120" not in comparison:
        raise BuildError(f"unexpected method change set: {comparison}")
    (work / "method-comparison.txt").write_text(comparison, encoding="utf-8")
    return candidate, {"changed": ["284:71120"], "changed_count": 1, "sha256": nav.sha256_file(candidate)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--ffdec", type=Path, required=True)
    parser.add_argument("--java", type=Path, required=True)
    parser.add_argument("--zipalign", type=Path, required=True)
    parser.add_argument("--apksigner", type=Path, required=True)
    parser.add_argument("--keystore", type=Path, required=True)
    parser.add_argument("--keystore-alias", default="wf")
    parser.add_argument("--password-env", required=True)
    args = parser.parse_args()
    nav = load_navigation_builder()
    nav.BASE_UUID = BASE_UUID
    nav.patch_copy = patch_copy
    if nav.sha256_file(args.base) != BASE_APK_SHA256:
        raise BuildError("input is not the requested direct-visibility LAN APK")
    if args.out.exists() or args.report.exists() or args.work.exists():
        raise BuildError("output/report/work already exists")
    if args.password_env not in os.environ:
        raise BuildError("signing credential environment variable is missing")
    args.work.mkdir(parents=True)
    nav.extract_swf(args.base, args.work / "baseline.swf")
    if nav.sha256_file(args.work / "baseline.swf") != BASE_SWF_SHA256:
        raise BuildError("base SWF hash mismatch")
    candidate, swf_report = build_swf(nav, args.work, args.java, args.ffdec)
    new_uuid = str(uuid.uuid4())
    unsigned = args.work / "unsigned.apk"
    aligned = args.work / "aligned.apk"
    signed = args.work / "signed.apk"
    nav.replace_apk(args.base, candidate, unsigned, new_uuid)
    nav.run([args.zipalign, "-p", "-f", "4", unsigned, aligned], timeout=300)
    nav.run([args.java, "-jar", args.apksigner, "sign", "--ks", args.keystore,
             "--ks-key-alias", args.keystore_alias, "--ks-pass", f"env:{args.password_env}",
             "--key-pass", f"env:{args.password_env}", "--out", signed, aligned], timeout=300)
    nav.run([args.zipalign, "-c", "-p", "4", signed], timeout=300)
    verification = nav.verify_apk(args.base, signed, candidate, new_uuid, args.java, args.apksigner)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    signed.replace(args.out)
    report = {
        "schema_version": 1,
        "status": "verified",
        "patch_id": "rush-leaderboard-self-profile-lan-20260906",
        "base_apk": {"path": str(args.base.resolve()), "sha256": BASE_APK_SHA256},
        "base_swf_sha256": BASE_SWF_SHA256,
        "direct_visibility_fix_preserved": True,
        "self_profile_route": "row.id == globalLogic.getPlayer().get_viewerId() -> ProfileGetMyProfile",
        "swf": swf_report,
        "apk": verification,
        "artifacts": {"signed_apk": {"path": str(args.out.resolve()), "sha256": nav.sha256_file(args.out)}}
    }
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (BuildError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print(f"[ERROR] {error}")
        raise SystemExit(1)
