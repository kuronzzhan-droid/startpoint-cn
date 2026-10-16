#!/usr/bin/env python3
"""Build the public APK from the verified self-profile LAN APK."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import subprocess
import uuid
from pathlib import Path

from apk_build_common import resolve_lan_host

BASE_APK_SHA256 = "972ee319a8e6a9fefeb3360671d5dbd322a5c45b7fa39f4701c3a09b9a9c8049"
BASE_SWF_SHA256 = "ee768121c80460cd07f92883eaea4ffec86243843a4f98d106b74fe664533684"
BASE_UUID = "b61eb71c-dda3-4b84-af8c-60213de3f46b"
PUBLIC_HOST = "TEST-SERVER-HOST:8001"
CONFIG_CLASS = "pinball.config.gbits.DevConfig_gf_android"
CONFIG_BODY = 92013


class BuildError(RuntimeError):
    pass


def load_navigation_builder():
    path = Path(__file__).with_name("build_navigation_apk.py")
    spec = importlib.util.spec_from_file_location("rush_navigation_builder_public", path)
    if spec is None or spec.loader is None:
        raise BuildError(f"cannot load navigation builder: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def export_constructor(nav, java: Path, ffdec: Path, swf: Path, root: Path) -> str:
    nav.run([
        java, "-Xmx4g", "-jar", ffdec, "-onerror", "abort", "-format", "script:pcode",
        "-selectclass", CONFIG_CLASS, "-export", "script", root, swf,
    ])
    path = root / "scripts/pinball/config/gbits/DevConfig_gf_android.pcode"
    if not path.is_file():
        raise BuildError(f"FFDec did not export {path}")
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    declaration = next(i for i, line in enumerate(lines) if re.search(r"public function DevConfig_gf_android\s*\(", line))
    start = next(i for i in range(declaration, len(lines)) if lines[i].strip() == "method")
    indent = len(lines[start]) - len(lines[start].lstrip())
    end = next(i for i in range(start + 1, len(lines)) if lines[i].strip() == "end ; method" and len(lines[i]) - len(lines[i].lstrip()) == indent)
    return "\n".join(lines[start:end + 1]) + "\n"


def replace_config(method: str, lan_host: str) -> str:
    old = f'pushstring "{lan_host}"'
    if method.count(old) != 1:
        raise BuildError("LAN endpoint is not present exactly once in config constructor")
    return method.replace(old, f'pushstring "{PUBLIC_HOST}"', 1)


def main() -> int:
    parser = argparse.ArgumentParser()
    for name in ("base", "out", "report", "work", "ffdec", "java", "zipalign", "apksigner", "keystore"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--keystore-alias", default="wf")
    parser.add_argument("--password-env", required=True)
    parser.add_argument("--lan-host", help="source host:port; defaults to environment or ignored local config")
    args = parser.parse_args()
    lan_host = resolve_lan_host(args.lan_host)
    nav = load_navigation_builder()
    nav.BASE_UUID = BASE_UUID
    if nav.sha256_file(args.base) != BASE_APK_SHA256:
        raise BuildError("input is not the verified self-profile LAN v2 APK")
    if args.out.exists() or args.report.exists() or args.work.exists():
        raise BuildError("output/report/work already exists")
    if args.password_env not in os.environ:
        raise BuildError("signing credential environment variable is missing")
    args.work.mkdir(parents=True)
    baseline = args.work / "baseline.swf"
    nav.extract_swf(args.base, baseline)
    if nav.sha256_file(baseline) != BASE_SWF_SHA256:
        raise BuildError("base SWF hash mismatch")
    method = replace_config(export_constructor(nav, args.java, args.ffdec, baseline, args.work / "config-pcode"), lan_host)
    method_file = args.work / "DevConfig_gf_android-constructor-public.pcode"
    method_file.write_text(method, encoding="utf-8", newline="\n")
    candidate = args.work / "self-profile-navigation-public.swf"
    nav.run([
        args.java, "-Xmx4g", "-jar", args.ffdec, "-air", "-onerror", "abort", "-replace",
        baseline, candidate, CONFIG_CLASS, method_file, str(CONFIG_BODY),
    ])
    tools = args.work / "method-tools"
    tools.mkdir()
    source = Path(__file__).resolve().parents[1] / "character-carousel"
    nav.run(["javac", "-cp", args.ffdec, "-d", tools, source / "CompareMethodBodies.java"], timeout=300)
    comparison = nav.run([
        args.java, "-cp", f"{tools}{os.pathsep}{args.ffdec}", "CompareMethodBodies", baseline, candidate,
    ], capture=True, timeout=300)
    if "changed_count=1" not in comparison or "changed=284:92013" not in comparison:
        raise BuildError(f"unexpected method change set: {comparison}")
    (args.work / "method-comparison.txt").write_text(comparison, encoding="utf-8")
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
        "patch_id": "rush-leaderboard-self-profile-public-20260906",
        "base_apk": {"path": str(args.base.resolve()), "sha256": BASE_APK_SHA256},
        "base_swf_sha256": BASE_SWF_SHA256,
        "self_profile_route_preserved": True,
        "direct_visibility_fix_preserved": True,
        "endpoint": f"http://{PUBLIC_HOST}",
        "swf": {"changed": ["284:92013"], "changed_count": 1, "sha256": nav.sha256_file(candidate)},
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
