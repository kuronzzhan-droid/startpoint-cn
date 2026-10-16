#!/usr/bin/env python3
"""Restore the CNtips_b hide on the cumulative self-profile public APK."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import textwrap
import uuid

from apk_build_common import BuildError, extract_swf, replace_apk, run, sha256, verify

BASE_APK_SHA256 = "da49d1b8fa6cb022db4cfcfb62ecb6b4a79c7b4a9efe40cf3fd7c49b6e85f8ce"
BASE_SWF_SHA256 = "b0ae6fbc4adc1de7a87b282b63a905dce8490c65dd1acaaf5bd06cd305f44015"
BASE_UUID = "a69eb356-5730-4709-a5fb-d8b199bba680"
TITLE_CLASS = "pinball.scene.title.TitleView"
TITLE_METHOD = "refreshHealth"


def export_title(args, swf: Path, destination: Path) -> str:
    run([args.java, "-Xmx4g", "-jar", args.ffdec, "-onerror", "abort",
         "-format", "script:pcode", "-selectclass", TITLE_CLASS,
         "-export", "script", destination, swf])
    path = destination / "scripts/pinball/scene/title/TitleView.pcode"
    return path.read_text(encoding="utf-8-sig")


def extract_method(full: str, name: str) -> str:
    lines = full.splitlines()
    marker = f'trait method QName(PackageNamespace(""),"{name}")'
    starts = [i for i, line in enumerate(lines) if line.strip() == marker]
    if len(starts) != 1:
        raise BuildError(f"expected one TitleView.{name}")
    start = starts[0]
    indent = len(lines[start]) - len(lines[start].lstrip())
    end = next(i for i in range(start + 1, len(lines))
               if lines[i].strip() == "end ; method"
               and len(lines[i]) - len(lines[i].lstrip()) == indent + 3)
    return textwrap.dedent("\n".join(lines[start:end + 1]) + "\n")


def visibility_assignment(field: str, value: bool) -> str:
    return "\n".join([
        f'            findproperty QName(PackageNamespace(""),"{field}")',
        f'            getproperty QName(PackageNamespace(""),"{field}")',
        f'            push{str(value).lower()}',
        '            initproperty QName(PackageNamespace(""),"visible")',
    ])


def patch_refresh(method: str) -> str:
    # run() initially hides both images; refreshHealth(true) and subsequent
    # draw() calls used to re-enable CNtips_b whenever isHealth was false.
    old = visibility_assignment("copyrightImage", True)
    if method.count(old) != 1:
        raise BuildError("expected one copyrightImage.visible=true assignment")
    patched = method.replace(old, visibility_assignment("copyrightImage", False), 1)
    if patched.count(visibility_assignment("copyrightImage", False)) != 2:
        raise BuildError("both health-state branches must hide CNtips_b")
    for visible in (False, True):
        marker = visibility_assignment("friendShipTipsImage", visible)
        if method.count(marker) != 1 or patched.count(marker) != 1:
            raise BuildError("CNtips_a behavior was changed")
    return patched


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("base", "out", "work", "java", "javac", "ffdec", "zipalign", "apksigner", "keystore"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    parser.add_argument("--password-env", required=True)
    args = parser.parse_args()
    if sha256(args.base) != BASE_APK_SHA256:
        raise BuildError("base must be the latest cumulative self-profile public APK")
    if args.out.exists() or args.work.exists():
        raise BuildError("output/work already exists")
    if not os.environ.get(args.password_env):
        raise BuildError("missing signing environment variable")
    args.work.mkdir(parents=True)
    baseline = args.work / "baseline.swf"
    extract_swf(args.base, baseline)
    if sha256(baseline) != BASE_SWF_SHA256:
        raise BuildError("baseline embedded SWF does not match")
    source_title = export_title(args, baseline, args.work / "source-title")
    source_method = extract_method(source_title, TITLE_METHOD)
    method = patch_refresh(source_method)
    pcode = args.work / "refreshHealth-hide-CNtips_b.pcode"
    pcode.write_text(method, encoding="utf-8", newline="\n")
    helpers = args.work / "method-tools"
    helpers.mkdir()
    helper_src = Path(__file__).resolve().parents[1] / "character-carousel"
    run([args.javac, "-cp", args.ffdec, "-d", helpers,
         helper_src / "FindMethodBody.java", helper_src / "CompareMethodBodies.java"])
    cp = os.pathsep.join((str(helpers), str(args.ffdec)))
    locator = run([args.java, "-cp", cp, "FindMethodBody", baseline,
                   TITLE_CLASS, TITLE_METHOD], capture=True)
    expected_location = f"{TITLE_CLASS}.{TITLE_METHOD}\tabc=284\tbody=82510"
    if locator.strip() != expected_location:
        raise BuildError(f"unexpected TitleView method location: {locator}")
    candidate = args.work / "title-cntips-hidden.swf"
    run([args.java, "-Xmx4g", "-jar", args.ffdec, "-air", "-onerror", "abort",
         "-replace", baseline, candidate, TITLE_CLASS, pcode, "82510"])
    comparison = run([args.java, "-Xmx4g", "-cp", cp, "CompareMethodBodies",
                      baseline, candidate], capture=True)
    if set(comparison.strip().splitlines()) != {
        "method_bodies=96397", "changed_count=1", "changed=284:82510",
    }:
        raise BuildError(f"unexpected SWF method changes: {comparison}")
    (args.work / "method-comparison.txt").write_text(comparison, encoding="utf-8")
    # Read the resulting SWF back: checking only the input pcode misses a
    # failed import. Every TitleView instruction except this Boolean is kept.
    actual_title = export_title(args, candidate, args.work / "final-title")
    if extract_method(actual_title, TITLE_METHOD) != method:
        raise BuildError("final SWF does not contain the intended title method")
    # Standalone methods have different indentation from full class exports.
    def normalize(value: str) -> str:
        return "\n".join(line.strip() for line in value.splitlines() if line.strip())

    expected = normalize(source_title).replace(normalize(source_method), normalize(method), 1)
    if expected != normalize(actual_title):
        raise BuildError("unrelated TitleView instructions changed")
    new_uuid = str(uuid.uuid4())
    unsigned, aligned, signed = (args.work / name for name in ("unsigned.apk", "aligned.apk", "signed.apk"))
    replace_apk(args.base, candidate, unsigned, new_uuid, base_uuid=BASE_UUID)
    run([args.zipalign, "-p", "-f", "4", unsigned, aligned])
    unsigned.unlink()
    run([args.java, "-jar", args.apksigner, "sign", "--ks", args.keystore,
         "--ks-key-alias", "wf", "--ks-pass", f"env:{args.password_env}",
         "--key-pass", f"env:{args.password_env}", "--out", signed, aligned])
    aligned.unlink()
    run([args.zipalign, "-c", "-p", "4", signed])
    report = verify(args.base, signed, candidate, new_uuid, args.java, args.apksigner, base_uuid=BASE_UUID)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    signed.replace(args.out)
    report.update({
        "schema_version": 1, "status": "locally_verified_test_candidate",
        "runtime_or_device_verified": False,
        "base_apk": str(args.base.resolve()), "base_apk_sha256": BASE_APK_SHA256,
        "base_swf_sha256": BASE_SWF_SHA256, "base_uniqueappversionid": BASE_UUID,
        "apk": str(args.out.resolve()), "endpoint": "http://TEST-SERVER-HOST:8001",
        "changed_methods": ["284:82510"], "CNtips_b_hidden_in_both_health_states": True,
        "CNtips_a_behavior_preserved": True, "self_profile_and_follow_fixes_preserved": True,
        "zipalign": True, "final_swf_reexport_verified": True,
    })
    (args.out.parent / "verification-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
