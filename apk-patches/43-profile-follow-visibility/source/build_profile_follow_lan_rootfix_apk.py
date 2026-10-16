#!/usr/bin/env python3
"""Reproduce the accepted direct-visibility LAN profile fix from r12b.

The candidate starts from the retained r12b APK, keeps the LAN endpoint change,
and patches the client initialization and action paths involved in the observed
failure: the initial button refresh, the defensive action dispatch for a
stale/mismatched remove-button frame, and the LAN endpoint.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import uuid
import zipfile
from pathlib import Path

from apk_build_common import (
    BuildError,
    CERT_SHA256,
    extract_swf,
    replace_apk,
    resolve_lan_host,
    run,
    sha256,
    verify,
)

BASE_APK_SHA256 = "293baba18010688c836c2d94002d98c29fda0468f78aff14847eb75d9e8c58f1"
BASE_SWF_SHA256 = "bf43fa01bf572f334d6f012d119e96af0272cf61a96e1c1a0e9f6923cbb5be4f"
BASE_UUID = "08468b1e-5dbd-47a4-9aec-00b7d1c97099"
PUBLIC_HOST = "TEST-SERVER-HOST:8001"
CONFIG_CLASS = "pinball.config.gbits.DevConfig_gf_android"
CONFIG_BODY = 92013
PROFILE_CLASS = "pinball.scene.playerProfile.PlayerProfileView"
PROFILE_METHOD = "refreshFollowRelationButtons"
PROFILE_BODY = 79085
OTHER_CLASS = "pinball.scene.playerProfile.profile.otherProfile.OtherProfileLogic"
OTHER_METHOD = "applyButton"
OTHER_BODY = 79222


def export_method(java: Path, ffdec: Path, swf: Path, root: Path, class_name: str, method_name: str) -> tuple[Path, str]:
    run([
        java, "-Xmx4g", "-jar", ffdec, "-onerror", "abort", "-format", "script:pcode",
        "-selectclass", class_name, "-export", "script", root, swf,
    ])
    path = root / ("scripts/" + class_name.replace(".", "/") + ".pcode")
    if not path.is_file():
        raise BuildError(f"FFDec did not export {path}")
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    function_name = class_name.rsplit(".", 1)[-1] if method_name == "<constructor>" else method_name
    declaration = next(i for i, line in enumerate(lines) if re.search(
        rf"\bpublic function\s+{re.escape(function_name)}\s*\(", line
    ))
    if method_name == "<constructor>":
        start = next(i for i in range(declaration + 1, len(lines)) if lines[i].strip() == "method")
        indent = len(lines[start]) - len(lines[start].lstrip())
        end = next(i for i in range(start + 1, len(lines)) if lines[i].strip() == "end ; method" and len(lines[i]) - len(lines[i].lstrip()) == indent)
        return path, "\n".join(lines[start:end + 1]) + "\n"
    start = declaration
    trait = next(i for i in range(start, len(lines)) if "trait method QName" in lines[i])
    indent = len(lines[trait]) - len(lines[trait].lstrip())
    end = next(i for i in range(trait + 1, len(lines)) if (
        lines[i].strip() == "end ; method"
        and len(lines[i]) - len(lines[i].lstrip()) == indent + 3
    ))
    return path, "\n".join(lines[trait:end + 1]) + "\n"


def patch_profile(method: str) -> str:
    old = "lookupswitch ofs0098, [ofs00a3, ofs009c, ofs009c, ofs00a3]"
    if method.count(old) != 1:
        raise BuildError("profile method is not the retained r12b baseline")
    # Keep the accepted state-to-frame mapping, but also set the two concrete
    # button containers.  Some profile layouts retain the default child
    # visibility after the parent timeline is switched, which is why the
    # parent goto alone leaves state 0 showing “取消关注”.
    marker = (
        '                                             getlocal 4\n'
        '                                             callpropvoid QName(PackageNamespace(""),"goto"), 1\n'
        '                                             findproperty QName(PackageNamespace(""),"mainLayer")'
    )
    if method.count(marker) != 1:
        raise BuildError("profile relation container goto marker is missing")
    direct = (
        '                                             getlocal 4\n'
        '                                             callpropvoid QName(PackageNamespace(""),"goto"), 1\n'
        '                                             getlocal3\n'
        '                                             iffalse ofs0500\n'
        '                                             findproperty QName(PackageNamespace(""),"mainLayer")\n'
        '                                             getproperty QName(PackageNamespace(""),"mainLayer")\n'
        '                                             pushstring "top_right_button_layer"\n'
        '                                             newobject 0\n'
        '                                             callproperty QName(PackageNamespace(""),"getContainer"), 2\n'
        '                                             pushstring "follow_button"\n'
        '                                             newobject 0\n'
        '                                             callproperty QName(PackageNamespace(""),"getContainer"), 2\n'
        '                                             pushfalse\n'
        '                                             initproperty QName(PackageNamespace(""),"visible")\n'
        '                                             findproperty QName(PackageNamespace(""),"mainLayer")\n'
        '                                             getproperty QName(PackageNamespace(""),"mainLayer")\n'
        '                                             pushstring "top_right_button_layer"\n'
        '                                             newobject 0\n'
        '                                             callproperty QName(PackageNamespace(""),"getContainer"), 2\n'
        '                                             pushstring "remove_button"\n'
        '                                             newobject 0\n'
        '                                             callproperty QName(PackageNamespace(""),"getContainer"), 2\n'
        '                                             pushtrue\n'
        '                                             initproperty QName(PackageNamespace(""),"visible")\n'
        '                                             jump ofs0520\n'
        '                                    ofs0500:\n'
        '                                             findproperty QName(PackageNamespace(""),"mainLayer")\n'
        '                                             getproperty QName(PackageNamespace(""),"mainLayer")\n'
        '                                             pushstring "top_right_button_layer"\n'
        '                                             newobject 0\n'
        '                                             callproperty QName(PackageNamespace(""),"getContainer"), 2\n'
        '                                             pushstring "follow_button"\n'
        '                                             newobject 0\n'
        '                                             callproperty QName(PackageNamespace(""),"getContainer"), 2\n'
        '                                             pushtrue\n'
        '                                             initproperty QName(PackageNamespace(""),"visible")\n'
        '                                             findproperty QName(PackageNamespace(""),"mainLayer")\n'
        '                                             getproperty QName(PackageNamespace(""),"mainLayer")\n'
        '                                             pushstring "top_right_button_layer"\n'
        '                                             newobject 0\n'
        '                                             callproperty QName(PackageNamespace(""),"getContainer"), 2\n'
        '                                             pushstring "remove_button"\n'
        '                                             newobject 0\n'
        '                                             callproperty QName(PackageNamespace(""),"getContainer"), 2\n'
        '                                             pushfalse\n'
        '                                             initproperty QName(PackageNamespace(""),"visible")\n'
        '                                    ofs0520:\n'
        '                                             findproperty QName(PackageNamespace(""),"mainLayer")'
    )
    return method.replace(marker, direct, 1)


def patch_other(method: str) -> str:
    old = "lookupswitch ofs02e7, [ofs0344, ofs02eb, ofs02eb, ofs0344]"
    new = "lookupswitch ofs02e7, [ofs0259, ofs02eb, ofs02eb, ofs0259]"
    if method.count(old) != 1:
        raise BuildError("other-profile applyButton is not the retained r12b baseline")
    return method.replace(old, new, 1)


def replace_method(java: Path, ffdec: Path, baseline: Path, candidate: Path, class_name: str, body: int, method_file: Path) -> None:
    run([java, "-Xmx4g", "-jar", ffdec, "-air", "-onerror", "abort", "-replace",
         baseline, candidate, class_name, method_file, str(body)])


def main() -> int:
    parser = argparse.ArgumentParser()
    for name in ("base", "out", "work", "ffdec", "java", "javac", "zipalign", "apksigner", "keystore"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--password-env", required=True)
    parser.add_argument("--lan-host", help="host:port; defaults to environment or ignored local config")
    args = parser.parse_args()
    lan_host = resolve_lan_host(args.lan_host)
    if sha256(args.base) != BASE_APK_SHA256:
        raise BuildError("input is not the retained r12b baseline")
    if args.out.exists():
        raise BuildError("output already exists; refusing to overwrite it")
    if not os.environ.get(args.password_env):
        raise BuildError("signing credential environment variable is missing")
    args.work.mkdir(parents=True, exist_ok=False)
    baseline = args.work / "r12b-baseline.swf"
    extract_swf(args.base, baseline)
    if sha256(baseline) != BASE_SWF_SHA256:
        raise BuildError("baseline SWF hash mismatch")

    profile_path, profile_method = export_method(args.java, args.ffdec, baseline, args.work / "profile-pcode", PROFILE_CLASS, PROFILE_METHOD)
    other_path, other_method = export_method(args.java, args.ffdec, baseline, args.work / "other-pcode", OTHER_CLASS, OTHER_METHOD)
    config_path, config_method = export_method(args.java, args.ffdec, baseline, args.work / "config-pcode", CONFIG_CLASS, "<constructor>")
    profile_patched = patch_profile(profile_method)
    other_patched = patch_other(other_method)
    config_old = f'pushstring "{PUBLIC_HOST}"'
    if config_method.count(config_old) != 1:
        raise BuildError("r12b constructor does not contain the expected public endpoint")
    config_patched = config_method.replace(config_old, f'pushstring "{lan_host}"', 1)
    profile_file = args.work / "refreshFollowRelationButtons.pcode"
    other_file = args.work / "applyButton.pcode"
    config_file = args.work / "DevConfig_gf_android-constructor-lan.pcode"
    profile_file.write_text(profile_patched, encoding="utf-8")
    other_file.write_text(other_patched, encoding="utf-8")
    config_file.write_text(config_patched, encoding="utf-8")

    first = args.work / "profile-direct-button-visibility-fixed.swf"
    second = args.work / "other-follow-fixed.swf"
    candidate = args.work / "lan-rootfix.swf"
    # The retained r12b profile method already has the correct frame mapping:
    # frame 1 is “取消关注” and frame 2 is “关注”. Do not rewrite it here;
    # the previous diagnostic build inverted this mapping and caused the
    # observed no-op when clicking the “关注” button.
    replace_method(args.java, args.ffdec, baseline, first, PROFILE_CLASS, PROFILE_BODY, profile_file)
    replace_method(args.java, args.ffdec, first, second, OTHER_CLASS, OTHER_BODY, other_file)
    replace_method(args.java, args.ffdec, second, candidate, CONFIG_CLASS, CONFIG_BODY, config_file)

    tools_dir = args.work / "method-tools"
    tools_dir.mkdir()
    source_root = Path(__file__).resolve().parent.parent / "character-carousel"
    run([args.javac, "-cp", args.ffdec, "-d", tools_dir,
         source_root / "CompareMethodBodies.java"])
    classpath = os.pathsep.join((str(tools_dir), str(args.ffdec)))
    compared = run([args.java, "-Xmx4g", "-cp", classpath, "CompareMethodBodies", baseline, candidate], capture=True)
    expected = {"method_bodies=96397", "changed_count=3", "changed=284:79085,284:79222,284:92013"}
    if set(compared.strip().splitlines()) != expected:
        raise BuildError(f"unexpected SWF changes: {compared}")
    (args.work / "method-comparison.txt").write_text(compared, encoding="utf-8")

    new_uuid = str(uuid.uuid4())
    unsigned = args.work / "unsigned.apk"
    aligned = args.work / "aligned.apk"
    signed = args.work / "signed.apk"
    replace_apk(args.base, candidate, unsigned, new_uuid, base_uuid=BASE_UUID)
    run([args.zipalign, "-p", "-f", "4", unsigned, aligned])
    run([args.java, "-jar", args.apksigner, "sign", "--ks", args.keystore, "--ks-key-alias", "wf",
         "--ks-pass", f"env:{args.password_env}", "--key-pass", f"env:{args.password_env}", "--out", signed, aligned])
    run([args.zipalign, "-c", "-p", "4", signed])
    verification = verify(args.base, signed, candidate, new_uuid, args.java, args.apksigner, base_uuid=BASE_UUID)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    signed.replace(args.out)
    verification.update({
        "status": "locally_verified_test_candidate",
        "runtime_or_device_verified": False,
        "endpoint": f"http://{lan_host}",
        "base_apk_sha256": BASE_APK_SHA256,
        "base_swf_sha256": BASE_SWF_SHA256,
        "base_uniqueappversionid": BASE_UUID,
        "changed_methods_from_r12b": ["284:79085", "284:79222", "284:92013"],
        "method_body_count": 96397,
        "profile_mapping_preserved_correctly": True,
        "direct_follow_and_remove_button_visibility": True,
        "remove_button_state_0_3_dispatches_add": True,
        "apk_other_members_unchanged": True,
        "zipalign": True,
        "signature_v1": True,
        "signature_v2": True,
        "apk": str(args.out.resolve()),
    })
    (args.out.parent / "verification-report.json").write_text(json.dumps(verification, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(verification, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
