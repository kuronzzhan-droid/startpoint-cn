#!/usr/bin/env python3
"""Build a public APK from the latest accepted public client with Rush navigation fixes."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import textwrap
import uuid
import zipfile
from pathlib import Path

TARGET_SWF = "assets/worldflipper_android_release.swf"
MANIFEST = "AndroidManifest.xml"
OLD_SIGNATURES = {"META-INF/MANIFEST.MF", "META-INF/WF.SF", "META-INF/WF.RSA"}
TARGET_CLASS = "pinball.scene.event.rush.ranking.party.RushEventRankingPartyScene"
TARGET_CONTENT_CLASS = "pinball.scene.event.rush.ranking.party.list.cell._RushEventRankingPartyListCellView.RushEventRankingPartyListCellContentView"
BASE_APK_SHA256 = "b62c5237193fe178fb54b9d37e7bac3499a15263a3886cdfa21891490f853461"
BASE_SWF_SHA256 = "4f0b85d3801fb0620851971e9b75187033d1d9f15f72673454c9b1e9bd75320d"
BASE_UUID = "78bdc07c-21ea-4214-921d-587036b35136"
CERT_SHA256 = "569d19a3578d4cba16e3d6e7ad8ccab4fa667efc758deef6c9be3adb99919894"
EXPECTED_KEYS = {"284:71113", "284:71120", "284:71162"}


class BuildError(RuntimeError):
    pass


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(command: list[str | Path], *, capture: bool = False, timeout: int = 600) -> str:
    completed = subprocess.run(
        [str(value) for value in command],
        check=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
        timeout=timeout,
    )
    return completed.stdout or ""


def load_patch_module():
    path = Path(__file__).with_name("patch.py")
    spec = importlib.util.spec_from_file_location("rush_leaderboard_patch", path)
    if spec is None or spec.loader is None:
        raise BuildError(f"cannot load patch module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def extract_swf(apk: Path, output: Path) -> None:
    with zipfile.ZipFile(apk) as archive:
        matches = [item for item in archive.infolist() if item.filename == TARGET_SWF]
        if len(matches) != 1:
            raise BuildError(f"expected exactly one {TARGET_SWF}")
        output.write_bytes(archive.read(matches[0]))


def extract_method_pcode(full: Path, method: str) -> str:
    lines = full.read_text(encoding="utf-8-sig").replace("\r\n", "\n").splitlines()
    start = -1
    closing_indent = -1
    if method == "run" or method == "copyPlayedParty":
        needle = f'"{method}")'
        for index, line in enumerate(lines):
            if line.lstrip().startswith("trait method QName(") and needle in line:
                start = index
                indent = len(line) - len(line.lstrip(" "))
                closing_indent = indent + 3
                break
    if start < 0:
        raise BuildError(f"cannot find method {TARGET_CLASS}.{method}")
    end = -1
    for index in range(start + 1, len(lines)):
        line = lines[index]
        indent = len(line) - len(line.lstrip(" "))
        if line.strip() == "end ; method" and indent == closing_indent:
            end = index
            break
    if end < 0:
        raise BuildError(f"cannot find method terminator {TARGET_CLASS}.{method}")
    return textwrap.dedent("\n".join(lines[start:end + 1]) + "\n")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if text.count(old) != 1:
        raise BuildError(f"expected one {label}, found {text.count(old)}")
    return text.replace(old, new, 1)


def patch_run(text: str) -> str:
    old_pager = "\n".join([
        '            getlex QName(PackageNamespace(""),"partyList")',
        '            getlex QName(PackageNamespace("pinball.ui.component.list.core"),"VerticalListPagerConfig")',
        "            pushbyte 100",
        '            callproperty QName(PackageNamespace(""),"Set"), 1',
        '            setproperty QName(PackageNamespace(""),"pagerConfig")',
        "",
    ])
    text = replace_once(text, old_pager, old_pager, "ranking pager setup")
    old_behavior = "\n".join([
        '            getlex QName(PackageNamespace(""),"partyList")',
        "            pushbyte 0",
        '            callpropvoid QName(PackageNamespace(""),"set_cellSelectedBehavior"), 1',
        "",
    ])
    # Keep the accepted leaderboard's original cell behavior during scene
    # construction. Register the profile callback only after the list has
    # been mounted; the callback enables row selection after data arrives.
    patched_behavior = "\n".join([
        '            getlex QName(PackageNamespace(""),"partyList")',
        "            pushbyte 0",
        '            callpropvoid QName(PackageNamespace(""),"set_cellSelectedBehavior"), 1',
        "",
        '            getlex QName(PackageNamespace(""),"mode")',
        '            getproperty QName(PackageNamespace(""),"index")',
        "            pushbyte 0",
        "            equals",
        "            dup",
        "            iffalse ofs1100",
        "            pop",
        '            getlex QName(PackageNamespace(""),"mode")',
        '            getproperty QName(PackageNamespace(""),"params")',
        "            pushbyte 0",
        '            getproperty MultinameL([PackageNamespace(""),Namespace("http://adobe.com/AS3/2006/builtin"),PackageNamespace("pinball.scene.event.rush.ranking.party"),PackageInternalNs("pinball.scene.event.rush.ranking.party"),StaticProtectedNs("pinball.scene.ui:UiScene"),StaticProtectedNs("pinball.context.scene:LogicScene"),StaticProtectedNs("jp.sipo.gipo.core:GearHolderImpl"),PrivateNamespace("pinball.scene.event.rush.ranking.party:RushEventRankingPartyScene"),ProtectedNamespace("pinball.scene.event.rush.ranking.party:RushEventRankingPartyScene"),PrivateNamespace("RushEventRankingPartyScene.as$7283")])',
        "            convert_i",
        "            pushbyte 0",
        "            lessthan",
        "   ofs1100:",
        "            iffalse ofs1120",
        '            getlex QName(PackageNamespace(""),"partyList")',
        '            getlex QName(PackageNamespace(""),"copyPlayedParty")',
        '            callpropvoid QName(PackageNamespace(""),"addSelectHandler"), 1',
        "   ofs1120:",
        "",
    ])
    return replace_once(text, old_behavior, patched_behavior, "ranking profile selection handler")

def patch_copy(text: str) -> str:
    old = "            iffalse ofs03d1\n"
    new = "\n".join([
        "            iffalse ofs03d1",
        "            getlocal1",
        "            pushnull",
        "            ifeq ofs1000",
        '            pushstring "id"',
        "            getlocal1",
        "            in",
        "            iffalse ofs1010",
        "            getlocal1",
        '            getproperty QName(PackageNamespace(""),"id")',
        "            convert_d",
        "            pushbyte 0",
        "            ifngt ofs1000",
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
        "   ofs1000:",
        "            returnvoid",
        "   ofs1010:",
        "",
    ])
    text = replace_once(text, old, new, "ranking row selection branch")
    rows_anchor = "\n".join([
        "            getlocal 8",
        "            pushnull",
        "            ifeq ofs03d0",
        '            getlex QName(PackageNamespace(""),"partyList")',
        '            getproperty QName(PackageNamespace(""),"abstractAdapter")',
    ])
    rows_new = "\n".join([
        "            getlocal 8",
        "            pushnull",
        "            ifeq ofs03d0",
        '            getlex QName(PackageNamespace(""),"partyList")',
        "            pushbyte 1",
        '            callpropvoid QName(PackageNamespace(""),"set_cellSelectedBehavior"), 1',
        '            getlex QName(PackageNamespace(""),"partyList")',
        '            getproperty QName(PackageNamespace(""),"abstractAdapter")',
    ])
    return replace_once(text, rows_anchor, rows_new, "enable ranking row selection after data")


def patch_content_run(text: str) -> str:
    old = "\n".join([
        '            callproperty QName(Namespace("pinball.ui.provider:UiProvider"),"build"), 1',
        '            setproperty QName(PackageNamespace(""),"foregroundLayout")',
        "            jump ofs0077",
    ])
    new = "\n".join([
        '            callproperty QName(Namespace("pinball.ui.provider:UiProvider"),"build"), 1',
        '            setproperty QName(PackageNamespace(""),"foregroundLayout")',
        '            getlex QName(PackageNamespace(""),"extraButtonLayer")',
        "            pushfalse",
        '            setproperty QName(PackageNamespace(""),"touchable")',
        "            jump ofs0077",
    ])
    return replace_once(text, old, new, "ranking cell touch-through")


def prepare_pcodes(work: Path, java: Path, ffdec: Path):
    root = work / "baseline-pcode"
    run([
        java, "-Xmx4g", "-jar", ffdec, "-onerror", "abort",
        "-format", "script:pcode", "-selectclass", TARGET_CLASS,
        "-export", "script", root, work / "baseline.swf",
    ])
    full = root / "scripts/pinball/scene/event/rush/ranking/party/RushEventRankingPartyScene.pcode"
    if not full.is_file():
        raise BuildError(f"FFDec did not export {full}")
    run_pcode = patch_run(extract_method_pcode(full, "run"))
    copy_pcode = patch_copy(extract_method_pcode(full, "copyPlayedParty"))
    content_root = work / "baseline-content-pcode"
    run([
        java, "-Xmx4g", "-jar", ffdec, "-onerror", "abort",
        "-format", "script:pcode", "-selectclass", TARGET_CONTENT_CLASS,
        "-export", "script", content_root, work / "baseline.swf",
    ])
    content_full = content_root / "scripts/pinball/scene/event/rush/ranking/party/list/cell/_RushEventRankingPartyListCellView/RushEventRankingPartyListCellContentView.pcode"
    if not content_full.is_file():
        raise BuildError(f"FFDec did not export {content_full}")
    content_run_pcode = patch_content_run(extract_method_pcode(content_full, "run"))
    run_path = work / "run.pcode"
    copy_path = work / "copyPlayedParty.pcode"
    content_run_path = work / "content-run.pcode"
    run_path.write_text(run_pcode, encoding="utf-8", newline="\n")
    copy_path.write_text(copy_pcode, encoding="utf-8", newline="\n")
    content_run_path.write_text(content_run_pcode, encoding="utf-8", newline="\n")
    return run_path, copy_path, content_run_path


def locate_methods(work: Path, java: Path, ffdec: Path):
    tools = work / "method-tools"
    tools.mkdir()
    source = Path(__file__).resolve().parents[1] / "character-carousel"
    run(["javac", "-cp", ffdec, "-d", tools,
         source / "FindMethodBody.java", source / "CompareMethodBodies.java"], timeout=300)
    output = run([
        java, "-cp", f"{tools}{os.pathsep}{ffdec}", "FindMethodBody",
        work / "baseline.swf", TARGET_CLASS, "run", TARGET_CLASS, "copyPlayedParty",
        TARGET_CONTENT_CLASS, "run",
    ], capture=True, timeout=300)
    found = {}
    for line in output.splitlines():
        match = re.fullmatch(r"(.+)\.(run|copyPlayedParty)\tabc=(\d+)\tbody=(\d+)", line.strip())
        if match:
            found[f"{match.group(1)}.{match.group(2)}"] = (int(match.group(3)), int(match.group(4)))
    expected_locations = {
        f"{TARGET_CLASS}.run": (284, 71113),
        f"{TARGET_CLASS}.copyPlayedParty": (284, 71120),
        f"{TARGET_CONTENT_CLASS}.run": (284, 71162),
    }
    if set(found) != set(expected_locations):
        raise BuildError(f"method locator missing targets: {found}")
    if found != expected_locations:
        raise BuildError(f"latest public method locations changed: {found}")
    keys = {f"{abc}:{body}" for abc, body in found.values()}
    if keys != EXPECTED_KEYS:
        raise BuildError(f"latest public method locations changed: {found}")
    return found


def build_swf(work: Path, java: Path, ffdec: Path):
    run_pcode, copy_pcode, content_run_pcode = prepare_pcodes(work, java, ffdec)
    locations = locate_methods(work, java, ffdec)
    source = work / "baseline.swf"
    patches = (
        ("scene.run", TARGET_CLASS, "run", run_pcode),
        ("scene.copyPlayedParty", TARGET_CLASS, "copyPlayedParty", copy_pcode),
        ("content.run", TARGET_CONTENT_CLASS, "run", content_run_pcode),
    )
    for index, (key, class_name, method_name, pcode) in enumerate(patches, 1):
        destination = work / f"method-stage-{index}.swf"
        run([
            java, "-Xmx4g", "-jar", ffdec, "-air", "-onerror", "abort",
            "-replace", source, destination, class_name, pcode, str(locations[f"{class_name}.{method_name}"][1]),
        ])
        if not destination.is_file():
            raise BuildError(f"FFDec did not produce {destination}")
        if source != work / "baseline.swf":
            source.unlink(missing_ok=True)
        source = destination
    candidate = work / "navigation.swf"
    os.replace(source, candidate)
    comparison = run([
        java, "-cp", f"{work / 'method-tools'}{os.pathsep}{ffdec}",
        "CompareMethodBodies", work / "baseline.swf", candidate,
    ], capture=True, timeout=300)
    count = re.search(r"^changed_count=(\d+)$", comparison, re.MULTILINE)
    changed = re.search(r"^changed=(.*)$", comparison, re.MULTILINE)
    actual = {item for item in (changed.group(1).split(",") if changed else []) if item}
    if count is None or int(count.group(1)) != len(EXPECTED_KEYS) or actual != EXPECTED_KEYS:
        raise BuildError(f"unexpected method change set: {comparison}")
    return candidate, {"changed": sorted(actual), "changed_count": len(actual), "sha256": sha256_file(candidate)}


def replace_apk(base: Path, swf: Path, output: Path, new_uuid: str):
    with zipfile.ZipFile(base) as source:
        names = [item.filename for item in source.infolist()]
        if names.count(MANIFEST) != 1 or names.count(TARGET_SWF) != 1:
            raise BuildError("APK does not contain exactly one manifest and SWF")
        old_manifest = source.read(MANIFEST)
        old_utf16 = BASE_UUID.encode("utf-16le")
        new_utf16 = new_uuid.encode("utf-16le")
        if old_manifest.count(old_utf16) != 1:
            raise BuildError("accepted APK UUID is not present exactly once")
        manifest = old_manifest.replace(old_utf16, new_utf16, 1)
        with zipfile.ZipFile(output, "w", allowZip64=True) as target:
            target.comment = source.comment
            for item in source.infolist():
                if item.filename in OLD_SIGNATURES:
                    continue
                if item.filename == TARGET_SWF:
                    data = swf.read_bytes()
                elif item.filename == MANIFEST:
                    data = manifest
                else:
                    data = source.read(item.filename)
                target.writestr(item, data)


def verify_apk(base: Path, final: Path, swf: Path, new_uuid: str, java: Path, apksigner: Path):
    with zipfile.ZipFile(base) as left, zipfile.ZipFile(final) as right:
        left_names = {item.filename for item in left.infolist() if item.filename not in OLD_SIGNATURES}
        right_names = {item.filename for item in right.infolist() if item.filename not in OLD_SIGNATURES}
        if left_names != right_names:
            raise BuildError("APK member set changed")
        for name in sorted(left_names - {TARGET_SWF, MANIFEST}):
            if left.read(name) != right.read(name):
                raise BuildError(f"unrelated APK member changed: {name}")
        if sha256_bytes(right.read(TARGET_SWF)) != sha256_file(swf):
            raise BuildError("signed APK contains an unexpected SWF")
        manifest = right.read(MANIFEST)
        if manifest.count(new_uuid.encode("utf-16le")) != 1 or manifest.count(BASE_UUID.encode("utf-16le")) != 0:
            raise BuildError("signed APK UUID verification failed")
    output = run([java, "-jar", apksigner, "verify", "--verbose", "--print-certs", final], capture=True, timeout=300)
    if "Verified using v1 scheme (JAR signing): true" not in output or "Verified using v2 scheme (APK Signature Scheme v2): true" not in output:
        raise BuildError("APK signature verification failed")
    match = re.search(r"Signer\s+#1\s+certificate\s+SHA-256\s+digest:\s*([0-9a-fA-F]{64})", output)
    if match is None or match.group(1).lower() != CERT_SHA256:
        raise BuildError("APK signer certificate does not match the required certificate")
    return {"apk_sha256": sha256_file(final), "swf_sha256": sha256_file(swf),
            "signer_certificate_sha256": CERT_SHA256, "uniqueappversionid": new_uuid}


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
    for path in (args.base, args.ffdec, args.java, args.zipalign, args.apksigner, args.keystore):
        if not path.resolve().is_file():
            raise BuildError(f"missing build input: {path}")
    if args.out.resolve().exists() or args.report.resolve().exists() or args.work.resolve().exists():
        raise BuildError("output/report/work already exists")
    if args.password_env not in os.environ:
        raise BuildError(f"missing signing environment variable: {args.password_env}")
    base = args.base.resolve()
    if sha256_file(base) != BASE_APK_SHA256:
        raise BuildError("base APK is not the latest accepted public APK")
    args.work.resolve().mkdir(parents=True)
    baseline = args.work.resolve() / "baseline.swf"
    extract_swf(base, baseline)
    if sha256_file(baseline) != BASE_SWF_SHA256:
        raise BuildError("base APK SWF is not the latest accepted public SWF")
    candidate, swf_report = build_swf(args.work.resolve(), args.java.resolve(), args.ffdec.resolve())
    new_uuid = str(uuid.uuid4())
    unsigned = args.work.resolve() / "unsigned.apk"
    aligned = args.work.resolve() / "aligned.apk"
    signed = args.work.resolve() / "signed.apk"
    replace_apk(base, candidate, unsigned, new_uuid)
    run([args.zipalign, "-p", "-f", "4", unsigned, aligned], timeout=300)
    run([args.java, "-jar", args.apksigner, "sign", "--ks", args.keystore,
         "--ks-key-alias", args.keystore_alias, "--ks-pass", f"env:{args.password_env}",
         "--key-pass", f"env:{args.password_env}", "--out", signed, aligned], timeout=300)
    run([args.zipalign, "-c", "-p", "4", signed], timeout=300)
    verification = verify_apk(base, signed, candidate, new_uuid, args.java.resolve(), args.apksigner.resolve())
    args.out.resolve().parent.mkdir(parents=True, exist_ok=True)
    args.report.resolve().parent.mkdir(parents=True, exist_ok=True)
    os.replace(signed, args.out.resolve())
    report = {
        "schema_version": 1,
        "status": "verified",
        "patch_id": "rush-leaderboard-navigation-public-20260905-hitbox",
        "base_apk": {"path": str(base), "sha256": BASE_APK_SHA256},
        "base_swf_sha256": BASE_SWF_SHA256,
        "latest_accepted_public_apk": True,
        "public_endpoint_preserved": True,
        "swf": swf_report,
        "apk": verification,
        "artifacts": {
            "signed_apk": {"path": str(args.out.resolve()), "sha256": sha256_file(args.out.resolve())},
            "injected_swf": {"path": str(candidate), "sha256": sha256_file(candidate)},
        },
    }
    args.report.resolve().write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (BuildError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print(f"[ERROR] {error}")
        raise SystemExit(1)
