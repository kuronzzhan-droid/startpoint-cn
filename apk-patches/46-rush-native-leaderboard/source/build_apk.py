#!/usr/bin/env python3
"""Build, sign, reopen, and verify the Rush leaderboard client APK."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import uuid
import zipfile
from pathlib import Path
from typing import Any, Sequence


TARGET_SWF_MEMBER = "assets/worldflipper_android_release.swf"
MANIFEST_MEMBER = "AndroidManifest.xml"
EXPECTED_CERTIFICATE_SHA256 = "569d19a3578d4cba16e3d6e7ad8ccab4fa667efc758deef6c9be3adb99919894"
EXPECTED_BASE_APK_SHA256 = "fa45b7727b638accfdeb133e7e47eb3612b54af614d6c8da2001fdb60b603ccf"
EXPECTED_BASE_SWF_SHA256 = "e3e6cdc8d9a5d93a297912c571bef58239efb50f7b77132cf1768ad5a4260475"
EXPECTED_INCREMENTAL_REFERENCE_SWF_SHA256 = "7483797281f64ac53ac3284a93694e92686aa3891cbf7f5ff0f5cea702f76df0"
BASE_UNIQUE_APP_VERSION_ID = "808339e8-8e32-42f5-9a1a-d66cc876d4bb"
INCREMENTAL_METHODS = (
    (
        "pinball.scene.event.rush.ranking.party.RushEventRankingPartyScene",
        "copyPlayedParty",
    ),
    (
        "pinball.scene.event.rush.ranking.party.RushEventRankingPartyScene",
        "buttonClicked",
    ),
    ("pinball.scene.event.rush.top.RushEventTopScene", "run"),
    ("pinball.scene.event.rush.top.RushEventTopScene", "buttonClicked"),
    ("pinball.scene.event.rush.top.RushEventTopView", "run"),
)
SIGNATURE_SUFFIXES = (".SF", ".RSA", ".DSA", ".EC")


class BuildError(RuntimeError):
    pass


def load_patch_module() -> Any:
    path = Path(__file__).with_name("patch.py")
    spec = importlib.util.spec_from_file_location("rush_leaderboard_client_patch", path)
    if spec is None or spec.loader is None:
        raise BuildError(f"cannot load patch module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


patch = load_patch_module()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(command: Sequence[Path | str], *, capture: bool = False) -> str:
    completed = subprocess.run(
        [str(value) for value in command],
        check=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
    )
    return completed.stdout or ""


def apksigner_command(java: Path, apksigner: Path, *args: str | Path) -> list[Path | str]:
    if apksigner.suffix.lower() == ".jar":
        return [java, "-jar", apksigner, *args]
    return [apksigner, *args]


def is_signature_member(name: str) -> bool:
    parts = name.split("/")
    if len(parts) != 2 or parts[0].upper() != "META-INF":
        return False
    upper = parts[1].upper()
    return upper == "MANIFEST.MF" or upper.endswith(SIGNATURE_SUFFIXES)


def extract_swf(apk: Path, output: Path) -> None:
    with zipfile.ZipFile(apk) as archive:
        matches = [item for item in archive.infolist() if item.filename == TARGET_SWF_MEMBER]
        if len(matches) != 1:
            raise BuildError(f"expected one {TARGET_SWF_MEMBER}, found {len(matches)}")
        output.write_bytes(archive.read(matches[0]))


def export_targets(swf: Path, output_root: Path, java: Path, ffdec: Path) -> None:
    if output_root.exists():
        raise BuildError(f"export root already exists: {output_root}")
    for target in patch.TARGETS:
        run((
            java,
            "-jar",
            ffdec,
            "-onerror",
            "abort",
            "-selectclass",
            target.class_name,
            "-export",
            "script",
            output_root,
            swf,
        ))
    for target in patch.TARGETS:
        path = output_root / target.relative
        if not path.is_file() or path.stat().st_size == 0:
            raise BuildError(f"FFDec did not export {target.class_name}")


def build_carrier(
    baseline_swf: Path,
    patched_root: Path,
    carrier_swf: Path,
    transaction: Path,
    java: Path,
    ffdec: Path,
) -> list[dict]:
    source = baseline_swf
    previous_created: Path | None = None
    stages: list[dict] = []
    changed = [target for target in patch.TARGETS if target.patcher is not None]
    for index, target in enumerate(changed, start=1):
        destination = transaction / f"inject-stage-{index}.swf"
        run((
            java,
            "-jar",
            ffdec,
            "-onerror",
            "abort",
            "-replace",
            source,
            destination,
            target.class_name,
            patched_root / target.relative,
        ))
        if not destination.is_file() or destination.stat().st_size == 0:
            raise BuildError(f"FFDec did not create stage for {target.class_name}")
        stages.append({
            "class_name": target.class_name,
            "source_sha256": sha256_file(patched_root / target.relative),
        })
        if previous_created is not None:
            previous_created.unlink()
        source = destination
        previous_created = destination
    if previous_created is None:
        raise BuildError("no changed client classes were selected")
    os.replace(previous_created, carrier_swf)
    return stages


def compile_method_tools(javac: Path, ffdec: Path, output: Path) -> None:
    source_root = Path(__file__).resolve().parents[1] / "character-carousel"
    sources = [
        source_root / "FindMethodBody.java",
        source_root / "CompareMethodBodies.java",
    ]
    output.mkdir(parents=True)
    run((javac, "-cp", ffdec, "-d", output, *sources))


def method_classpath(classes: Path, ffdec: Path) -> str:
    return os.pathsep.join((str(classes), str(ffdec)))


def find_method_bodies(
    swf: Path,
    methods: Sequence[tuple[str, str]],
    java: Path,
    ffdec: Path,
    classes: Path,
) -> dict[tuple[str, str], tuple[int, int]]:
    arguments: list[str | Path] = [
        java,
        "-cp",
        method_classpath(classes, ffdec),
        "FindMethodBody",
        swf,
    ]
    for class_name, method_name in methods:
        arguments.extend((class_name, method_name))
    output = run(arguments, capture=True)
    found: dict[tuple[str, str], tuple[int, int]] = {}
    pattern = re.compile(r"^(.+)\tabc=(\d+)\tbody=(\d+)$")
    for line in output.splitlines():
        match = pattern.fullmatch(line.strip())
        if match is None:
            continue
        label, abc_index, body_index = match.groups()
        matched = [item for item in methods if f"{item[0]}.{item[1]}" == label]
        if len(matched) != 1:
            raise BuildError(f"ambiguous method locator output: {line}")
        found[matched[0]] = (int(abc_index), int(body_index))
    if set(found) != set(methods):
        missing = sorted(set(methods) - set(found))
        raise BuildError(f"method locator did not return every target: {missing}")
    return found


def target_for_class(class_name: str) -> Any:
    matches = [target for target in patch.TARGETS if target.class_name == class_name]
    if len(matches) != 1:
        raise BuildError(f"class does not map to exactly one patch target: {class_name}")
    return matches[0]


def export_carrier_pcode(
    carrier_swf: Path,
    output_root: Path,
    java: Path,
    ffdec: Path,
) -> dict[str, Path]:
    classes = tuple(dict.fromkeys(class_name for class_name, _method in patch.METHOD_PATCHES))
    for class_name in classes:
        run((
            java,
            "-jar",
            ffdec,
            "-onerror",
            "abort",
            "-format",
            "script:pcode",
            "-selectclass",
            class_name,
            "-export",
            "script",
            output_root,
            carrier_swf,
        ))
    result: dict[str, Path] = {}
    for class_name in classes:
        target = target_for_class(class_name)
        path = (output_root / target.relative).with_suffix(".pcode")
        if not path.is_file() or path.stat().st_size == 0:
            raise BuildError(f"FFDec did not export carrier P-code for {class_name}")
        result[class_name] = path
    return result


def extract_method_pcode(full_pcode: Path, class_name: str, method_name: str) -> str:
    lines = full_pcode.read_text(encoding="utf-8-sig").replace("\r\n", "\n").splitlines()
    start = -1
    start_indent = -1
    closing_indent = -1
    if method_name == "<constructor>":
        constructor = target_for_class(class_name).relative.stem
        signature = f"public function {constructor}("
        signature_index = next(
            (index for index, line in enumerate(lines) if signature in line),
            -1,
        )
        if signature_index >= 0:
            for index in range(signature_index + 1, len(lines)):
                if lines[index].strip() == "method":
                    start = index
                    start_indent = len(lines[index]) - len(lines[index].lstrip(" "))
                    closing_indent = start_indent
                    break
                if lines[index].lstrip().startswith("public function "):
                    break
    else:
        needle = f'"{method_name}")'
        for index, line in enumerate(lines):
            if line.lstrip().startswith("trait method QName(") and needle in line:
                start = index
                start_indent = len(line) - len(line.lstrip(" "))
                closing_indent = start_indent + 3
                break
    if start < 0:
        raise BuildError(f"cannot find P-code block for {class_name}.{method_name}")
    end = -1
    for index in range(start + 1, len(lines)):
        line = lines[index]
        indent = len(line) - len(line.lstrip(" "))
        if line.strip() == "end ; method" and indent == closing_indent:
            end = index
            break
    if end < 0:
        raise BuildError(f"cannot find P-code terminator for {class_name}.{method_name}")
    block = "\n".join(lines[start:end + 1]) + "\n"
    return textwrap.dedent(block)


def transplant_method_bodies(
    baseline_swf: Path,
    carrier_swf: Path,
    output_swf: Path,
    transaction: Path,
    java: Path,
    javac: Path,
    ffdec: Path,
) -> list[dict]:
    classes = transaction / "method-tools"
    compile_method_tools(javac, ffdec, classes)
    baseline_locations = find_method_bodies(
        baseline_swf, patch.METHOD_PATCHES, java, ffdec, classes
    )
    carrier_locations = find_method_bodies(
        carrier_swf, patch.METHOD_PATCHES, java, ffdec, classes
    )
    full_pcodes = export_carrier_pcode(
        carrier_swf, transaction / "carrier-pcode", java, ffdec
    )
    payload_root = transaction / "method-pcode"
    payload_root.mkdir()
    source = baseline_swf
    previous_created: Path | None = None
    report: list[dict] = []
    for index, (class_name, method_name) in enumerate(patch.METHOD_PATCHES, start=1):
        safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", f"{class_name}.{method_name}")
        pcode = payload_root / f"{index:02d}-{safe_name}.pcode"
        pcode.write_text(
            extract_method_pcode(full_pcodes[class_name], class_name, method_name),
            encoding="utf-8",
            newline="\n",
        )
        abc_index, body_index = baseline_locations[(class_name, method_name)]
        destination = transaction / f"method-stage-{index}.swf"
        run((
            java,
            "-jar",
            ffdec,
            "-air",
            "-onerror",
            "abort",
            "-replace",
            source,
            destination,
            class_name,
            pcode,
            str(body_index),
        ))
        if not destination.is_file() or destination.stat().st_size == 0:
            raise BuildError(f"FFDec did not replace {class_name}.{method_name}")
        carrier_abc, carrier_body = carrier_locations[(class_name, method_name)]
        report.append({
            "class_name": class_name,
            "method_name": method_name,
            "baseline_abc_index": abc_index,
            "baseline_body_index": body_index,
            "carrier_abc_index": carrier_abc,
            "carrier_body_index": carrier_body,
            "pcode_sha256": sha256_file(pcode),
        })
        if previous_created is not None:
            previous_created.unlink()
        source = destination
        previous_created = destination
    if previous_created is None:
        raise BuildError("no method bodies were selected")
    os.replace(previous_created, output_swf)

    comparison = run((
        java,
        "-cp",
        method_classpath(classes, ffdec),
        "CompareMethodBodies",
        baseline_swf,
        output_swf,
    ), capture=True)
    changed_match = re.search(r"^changed=(.*)$", comparison, re.MULTILINE)
    count_match = re.search(r"^changed_count=(\d+)$", comparison, re.MULTILINE)
    if changed_match is None or count_match is None:
        raise BuildError("method comparison output is malformed")
    actual = {item for item in changed_match.group(1).split(",") if item}
    expected = {
        f"{abc_index}:{body_index}"
        for abc_index, body_index in baseline_locations.values()
    }
    if int(count_match.group(1)) != len(expected) or actual != expected:
        raise BuildError(
            f"method-body change set differs: expected={sorted(expected)} actual={sorted(actual)}"
        )
    for item in report:
        item["comparison_key"] = (
            f"{item['baseline_abc_index']}:{item['baseline_body_index']}"
        )
    return report


def compare_method_body_keys(
    left: Path,
    right: Path,
    java: Path,
    ffdec: Path,
    classes: Path,
) -> set[str]:
    comparison = run((
        java,
        "-cp",
        method_classpath(classes, ffdec),
        "CompareMethodBodies",
        left,
        right,
    ), capture=True)
    changed_match = re.search(r"^changed=(.*)$", comparison, re.MULTILINE)
    count_match = re.search(r"^changed_count=(\d+)$", comparison, re.MULTILINE)
    if changed_match is None or count_match is None:
        raise BuildError("method comparison output is malformed")
    changed = {item for item in changed_match.group(1).split(",") if item}
    if int(count_match.group(1)) != len(changed):
        raise BuildError("method comparison count differs from its change set")
    return changed


def apply_incremental_reference(
    baseline_swf: Path,
    reference_swf: Path,
    full_rebuild_swf: Path,
    output_swf: Path,
    transaction: Path,
    method_report: list[dict],
    java: Path,
    ffdec: Path,
) -> dict:
    if sha256_file(reference_swf) != EXPECTED_INCREMENTAL_REFERENCE_SWF_SHA256:
        raise BuildError("incremental reference is not the verified deep-abyss scope/title SWF")
    classes = transaction / "method-tools"
    expected_all = {item["comparison_key"] for item in method_report}
    if compare_method_body_keys(baseline_swf, reference_swf, java, ffdec, classes) != expected_all:
        raise BuildError("incremental reference differs from the baseline outside the 15 approved methods")
    os.replace(output_swf, full_rebuild_swf)
    current_input = reference_swf
    target_keys: set[str] = set()
    method_names: list[str] = []
    for position, incremental_method in enumerate(INCREMENTAL_METHODS, start=1):
        try:
            target_index = patch.METHOD_PATCHES.index(incremental_method) + 1
        except ValueError as error:
            raise BuildError(
                f"incremental method is not in METHOD_PATCHES: {incremental_method}"
            ) from error
        class_name, method_name = incremental_method
        safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", f"{class_name}.{method_name}")
        pcode = transaction / "method-pcode" / f"{target_index:02d}-{safe_name}.pcode"
        target = next(
            (
                item for item in method_report
                if (item["class_name"], item["method_name"]) == incremental_method
            ),
            None,
        )
        if target is None or not pcode.is_file():
            raise BuildError(f"incremental method payload is missing: {incremental_method}")
        next_output = output_swf if position == len(INCREMENTAL_METHODS) else (
            transaction / f"incremental-stage-{position:02d}.swf"
        )
        run((
            java,
            "-jar",
            ffdec,
            "-air",
            "-onerror",
            "abort",
            "-replace",
            current_input,
            next_output,
            class_name,
            pcode,
            str(target["baseline_body_index"]),
        ))
        current_input = next_output
        target_keys.add(target["comparison_key"])
        method_names.append(f"{class_name}.{method_name}")
    reference_changes = compare_method_body_keys(
        reference_swf, output_swf, java, ffdec, classes
    )
    if reference_changes != target_keys:
        raise BuildError(
            f"incremental scope/title fix changed unexpected methods: {sorted(reference_changes)}"
        )
    baseline_changes = compare_method_body_keys(
        baseline_swf, output_swf, java, ffdec, classes
    )
    if baseline_changes != expected_all:
        raise BuildError(
            f"incremental result differs outside approved methods: {sorted(baseline_changes)}"
        )
    return {
        "reference_swf_sha256": sha256_file(reference_swf),
        "full_rebuild_swf_sha256": sha256_file(full_rebuild_swf),
        "methods": method_names,
        "comparison_keys": sorted(target_keys),
        "changed_count_from_reference": len(reference_changes),
        "changed_from_reference": sorted(reference_changes),
        "changed_count_from_baseline": len(baseline_changes),
        "changed_from_baseline": sorted(baseline_changes),
    }


def repack_apk_with_unique(
    base_apk: Path,
    unsigned_apk: Path,
    injected_swf: Path,
    new_unique: str,
) -> None:
    script = Path(__file__).resolve().parents[1] / "character-carousel" / "repack_apk_with_unique.py"
    run((
        sys.executable,
        "-X",
        "utf8",
        script,
        base_apk,
        injected_swf,
        unsigned_apk,
        "--expected-base-apk-sha256",
        EXPECTED_BASE_APK_SHA256,
        "--expected-base-swf-sha256",
        EXPECTED_BASE_SWF_SHA256,
        "--old-unique",
        BASE_UNIQUE_APP_VERSION_ID,
        "--new-unique",
        new_unique,
    ))


def signer_fingerprint(output: str) -> str:
    matches = re.findall(
        r"Signer\s+#1\s+certificate\s+SHA-256\s+digest:\s*([0-9a-fA-F]{64})",
        output,
    )
    if len(matches) != 1:
        raise BuildError("could not prove the APK signer certificate")
    value = matches[0].lower()
    if value != EXPECTED_CERTIFICATE_SHA256:
        raise BuildError(f"unexpected APK signer certificate: {value}")
    return value


def verify_apk(apk: Path, java: Path, apksigner: Path) -> str:
    output = run(
        apksigner_command(java, apksigner, "verify", "--verbose", "--print-certs", apk),
        capture=True,
    )
    if "Verified using v1 scheme (JAR signing): true" not in output:
        raise BuildError("APK v1 signature verification failed")
    if "Verified using v2 scheme (APK Signature Scheme v2): true" not in output:
        raise BuildError("APK v2 signature verification failed")
    return signer_fingerprint(output)


def verify_payload_preservation(
    base_apk: Path,
    final_apk: Path,
    injected_swf: Path,
    new_unique: str,
) -> dict:
    with zipfile.ZipFile(base_apk) as base, zipfile.ZipFile(final_apk) as final:
        base_map = {
            item.filename: item
            for item in base.infolist()
            if not is_signature_member(item.filename)
        }
        final_map = {
            item.filename: item
            for item in final.infolist()
            if not is_signature_member(item.filename)
        }
        if set(base_map) != set(final_map):
            missing = sorted(set(base_map) - set(final_map))[:5]
            extra = sorted(set(final_map) - set(base_map))[:5]
            raise BuildError(f"APK payload membership changed: missing={missing}, extra={extra}")
        preserved = 0
        for name, source in base_map.items():
            target = final_map[name]
            if name in {TARGET_SWF_MEMBER, MANIFEST_MEMBER}:
                continue
            if (source.file_size, source.CRC) != (target.file_size, target.CRC):
                raise BuildError(f"unrelated APK member changed: {name}")
            preserved += 1
        final_swf = final.read(TARGET_SWF_MEMBER)
        expected_swf_hash = sha256_file(injected_swf)
        if hashlib.sha256(final_swf).hexdigest() != expected_swf_hash:
            raise BuildError("signed APK contains the wrong injected SWF")
        manifest = final.read(MANIFEST_MEMBER)
        if manifest.count(new_unique.encode("utf-16le")) != 1:
            raise BuildError("signed APK does not contain the new uniqueappversionid exactly once")
        if manifest.count(BASE_UNIQUE_APP_VERSION_ID.encode("utf-16le")) != 0:
            raise BuildError("signed APK still contains the baseline uniqueappversionid")
        return {
            "unrelated_members_preserved": preserved,
            "injected_swf_sha256": expected_swf_hash,
            "uniqueappversionid": new_unique,
        }


def file_record(path: Path) -> dict:
    resolved = path.resolve()
    return {
        "path": str(resolved),
        "size": resolved.stat().st_size,
        "sha256": sha256_file(resolved),
    }


def publish_file_no_replace(source: Path, target: Path) -> None:
    """Publish an owned file without ever replacing a concurrent target."""
    temporary: Path | None = None
    try:
        try:
            os.link(source, target)
        except FileExistsError as error:
            raise BuildError(f"final output appeared during build: {target}") from error
        except OSError:
            with tempfile.NamedTemporaryFile(
                dir=target.parent,
                prefix=f".{target.name}.",
                suffix=".stage",
                delete=False,
            ) as handle:
                temporary = Path(handle.name)
                with source.open("rb") as stream:
                    shutil.copyfileobj(stream, handle, 1024 * 1024)
                handle.flush()
                os.fsync(handle.fileno())
            try:
                os.link(temporary, target)
            except FileExistsError as error:
                raise BuildError(f"final output appeared during build: {target}") from error
        source.unlink()
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def source_records(root: Path) -> list[dict]:
    return [
        {
            "class_name": target.class_name,
            **file_record(root / target.relative),
            "changed": target.patcher is not None,
        }
        for target in patch.TARGETS
    ]


def validate_report(path: Path) -> None:
    report = json.loads(path.read_text(encoding="utf-8"))
    if report.get("schema_version") != 1 or report.get("status") != "verified":
        raise BuildError("verification report status is invalid")
    if report.get("signer_certificate_sha256") != EXPECTED_CERTIFICATE_SHA256:
        raise BuildError("verification report signer differs")
    if report.get("method_bodies_changed") != len(patch.METHOD_PATCHES):
        raise BuildError("verification report method-body count differs")
    transplants = report.get("method_body_transplants")
    if not isinstance(transplants, list) or len(transplants) != len(patch.METHOD_PATCHES):
        raise BuildError("verification report method-body list differs")
    comparison_keys = [item.get("comparison_key") for item in transplants]
    if len(set(comparison_keys)) != len(patch.METHOD_PATCHES):
        raise BuildError("verification report method-body indexes are not unique")
    artifact_paths: list[dict] = [
        report["artifacts"]["base_apk"],
        report["artifacts"]["baseline_swf"],
        report["artifacts"]["temporary_carrier_swf"],
        report["artifacts"]["injected_swf"],
        report["artifacts"]["signed_apk"],
        *report["artifacts"]["patched_sources"],
        *report["artifacts"]["reexported_sources"],
    ]
    seen: set[str] = set()
    for item in artifact_paths:
        item_path = item.get("path")
        expected = item.get("sha256")
        if not isinstance(item_path, str) or not isinstance(expected, str):
            raise BuildError("verification report artifact is malformed")
        resolved = Path(item_path).resolve()
        if item_path != str(resolved) or item_path in seen:
            raise BuildError("verification report artifact path is not unique/canonical")
        seen.add(item_path)
        if sha256_file(resolved) != expected:
            raise BuildError(f"verification report artifact hash differs: {resolved}")
    unique = report.get("apk_payload", {}).get("uniqueappversionid")
    if not isinstance(unique, str) or unique == BASE_UNIQUE_APP_VERSION_ID:
        raise BuildError("verification report uniqueappversionid is invalid")
    if report["artifacts"]["base_apk"].get("sha256") != EXPECTED_BASE_APK_SHA256:
        raise BuildError("verification report base APK differs")
    if report["artifacts"]["baseline_swf"].get("sha256") != EXPECTED_BASE_SWF_SHA256:
        raise BuildError("verification report baseline SWF differs")


def preflight(args: argparse.Namespace) -> None:
    required = {
        "base APK": args.base,
        "FFDec": args.ffdec,
        "Java": args.java,
        "javac": args.javac,
        "zipalign": args.zipalign,
        "apksigner": args.apksigner,
        "keystore": args.keystore,
    }
    for label, path in required.items():
        if not path.resolve().is_file():
            raise BuildError(f"{label} is not a file: {path}")
    if args.output.resolve().exists() or args.report.resolve().exists():
        raise BuildError("final APK/report already exists; refusing to overwrite")
    if args.work.resolve().exists():
        raise BuildError("work directory already exists; refusing to reuse it")
    if args.password_env not in os.environ:
        raise BuildError(f"signing environment variable is missing: {args.password_env}")
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", args.password_env):
        raise BuildError("signing environment variable name is invalid")
    if os.path.normcase(str(args.base.resolve())) == os.path.normcase(str(args.output.resolve())):
        raise BuildError("base and output APK paths must differ")
    if sha256_file(args.base.resolve()) != EXPECTED_BASE_APK_SHA256:
        raise BuildError("base APK is not the approved character-carousel final baseline")
    if args.previous_swf is not None:
        previous_swf = args.previous_swf.resolve()
        if not previous_swf.is_file():
            raise BuildError(f"incremental reference SWF is not a file: {previous_swf}")
        if sha256_file(previous_swf) != EXPECTED_INCREMENTAL_REFERENCE_SWF_SHA256:
            raise BuildError("incremental reference SWF hash differs")


def build(args: argparse.Namespace) -> dict:
    preflight(args)
    base = args.base.resolve()
    output = args.output.resolve()
    report_path = args.report.resolve()
    work = args.work.resolve()
    java = args.java.resolve()
    javac = args.javac.resolve()
    ffdec = args.ffdec.resolve()
    zipalign = args.zipalign.resolve()
    apksigner = args.apksigner.resolve()
    keystore = args.keystore.resolve()
    password_env = args.password_env

    output.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True)
    baseline_swf = work / "baseline.swf"
    carrier_swf = work / "carrier.swf"
    injected_swf = work / "rush-leaderboard.swf"
    baseline_export = work / "baseline-export"
    patched_sources = work / "patched-sources"
    reexported_sources = work / "reexported-sources"
    unsigned_apk = work / "unsigned.apk"
    aligned_apk = work / "aligned.apk"
    signed_stage = work / "signed.apk"
    full_rebuild_swf = work / "full-rebuild.swf"

    output_owned = False
    report_owned = False
    try:
        base_certificate = verify_apk(base, java, apksigner)
        extract_swf(base, baseline_swf)
        if sha256_file(baseline_swf) != EXPECTED_BASE_SWF_SHA256:
            raise BuildError("approved APK contains an unexpected baseline SWF")
        export_targets(baseline_swf, baseline_export, java, ffdec)
        patch_report = patch.patch_tree(baseline_export, patched_sources)
        carrier_report = build_carrier(
            baseline_swf,
            patched_sources,
            carrier_swf,
            work,
            java,
            ffdec,
        )
        method_report = transplant_method_bodies(
            baseline_swf,
            carrier_swf,
            injected_swf,
            work,
            java,
            javac,
            ffdec,
        )
        incremental_report = None
        if args.previous_swf is not None:
            incremental_report = apply_incremental_reference(
                baseline_swf,
                args.previous_swf.resolve(),
                full_rebuild_swf,
                injected_swf,
                work,
                method_report,
                java,
                ffdec,
            )
        if sha256_file(injected_swf) == EXPECTED_BASE_SWF_SHA256:
            raise BuildError("leaderboard SWF unexpectedly matches the baseline")
        export_targets(injected_swf, reexported_sources, java, ffdec)
        patch.verify_tree(reexported_sources, require_baseline_terms=True)

        new_unique = str(uuid.uuid4())
        if new_unique == BASE_UNIQUE_APP_VERSION_ID:
            raise BuildError("new uniqueappversionid unexpectedly reused the baseline value")
        repack_apk_with_unique(base, unsigned_apk, injected_swf, new_unique)
        run((zipalign, "-p", "-f", "4", unsigned_apk, aligned_apk))
        unsigned_apk.unlink()
        run(apksigner_command(
            java,
            apksigner,
            "sign",
            "--ks",
            keystore,
            "--ks-key-alias",
            args.keystore_alias,
            "--ks-pass",
            f"env:{password_env}",
            "--key-pass",
            f"env:{password_env}",
            "--out",
            signed_stage,
            aligned_apk,
        ))
        aligned_apk.unlink()
        run((zipalign, "-c", "-p", "4", signed_stage))
        certificate = verify_apk(signed_stage, java, apksigner)
        publish_file_no_replace(signed_stage, output)
        output_owned = True
        preservation = verify_payload_preservation(
            base, output, injected_swf, new_unique
        )

        report = {
            "schema_version": 1,
            "status": "verified",
            "patch_id": "rush-leaderboard-native-method-bodies-v7-server-driven-rush",
            "signer_certificate_sha256": certificate,
            "base_signer_certificate_sha256": base_certificate,
            "classes_checked": len(patch.TARGETS),
            "classes_changed": len(carrier_report),
            "method_bodies_changed": len(method_report),
            "character_carousel_update_preserved": True,
            "ranking_navigation_type_safe": True,
            "ranking_reward_rich_text_html_shell": True,
            "ranking_reward_title_key": "quest_detail_reward",
            "ranking_protocol_server_driven": True,
            "unsupported_rush_uses_disabled_payload": True,
            "incremental_method_scope_verified": incremental_report is not None,
            "incremental_method_scope": incremental_report,
            "native_fields_consumed": {
                "item": True,
                "reward": True,
                "total": True,
                "page": True,
                "row": True,
                "index": True,
                "time": True,
            },
            "terms_of_service_loader_unchanged": True,
            "tool_agreement_remote_unchanged": True,
            "runtime_or_device_verified": False,
            "apk_payload": preservation,
            "patch_sources": patch_report,
            "temporary_carrier": carrier_report,
            "method_body_transplants": method_report,
            "artifacts": {
                "base_apk": file_record(base),
                "baseline_swf": file_record(baseline_swf),
                "temporary_carrier_swf": file_record(carrier_swf),
                "injected_swf": file_record(injected_swf),
                "incremental_reference_swf": (
                    file_record(args.previous_swf.resolve())
                    if args.previous_swf is not None else None
                ),
                "full_rebuild_swf": (
                    file_record(full_rebuild_swf)
                    if full_rebuild_swf.is_file() else None
                ),
                "signed_apk": file_record(output),
                "patched_sources": source_records(patched_sources),
                "reexported_sources": source_records(reexported_sources),
            },
        }
        report_raw = (json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        with tempfile.NamedTemporaryFile(
            dir=report_path.parent,
            prefix=f".{report_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary_report = Path(handle.name)
            handle.write(report_raw)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary_report, report_path)
        except FileExistsError as error:
            raise BuildError(f"final report appeared during build: {report_path}") from error
        finally:
            temporary_report.unlink(missing_ok=True)
        report_owned = True
        validate_report(report_path)
        run((zipalign, "-c", "-p", "4", output))
        verify_apk(output, java, apksigner)
        return report
    except BaseException:
        if output_owned:
            output.unlink(missing_ok=True)
        if report_owned:
            report_path.unlink(missing_ok=True)
        raise
    finally:
        os.environ.pop(password_env, None)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True, dest="output")
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--ffdec", type=Path, required=True)
    parser.add_argument("--java", type=Path, required=True)
    parser.add_argument("--javac", type=Path, required=True)
    parser.add_argument("--zipalign", type=Path, required=True)
    parser.add_argument("--apksigner", type=Path, required=True)
    parser.add_argument("--ks", type=Path, required=True, dest="keystore")
    parser.add_argument("--ks-alias", required=True, dest="keystore_alias")
    parser.add_argument("--ks-pass-env", required=True, dest="password_env")
    parser.add_argument("--previous-swf", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        report = build(args)
    except KeyboardInterrupt:
        print("[CANCELLED] APK build stopped; no final APK/report retained.", file=sys.stderr)
        return 130
    except (
        BuildError,
        patch.PatchError,
        OSError,
        UnicodeError,
        zipfile.BadZipFile,
        subprocess.CalledProcessError,
    ) as error:
        secret = os.environ.get(args.password_env)
        message = str(error).replace(secret, "<redacted>") if secret else str(error)
        print(f"[ERROR] {message}", file=sys.stderr)
        return 2
    artifact = report["artifacts"]["signed_apk"]
    print(
        f"[OK] verified APK {artifact['path']} sha256={artifact['sha256']} "
        f"certificate={report['signer_certificate_sha256']}"
    )
    print(f"[OK] report {args.report.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
