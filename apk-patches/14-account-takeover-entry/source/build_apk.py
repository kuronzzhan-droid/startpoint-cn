#!/usr/bin/env python3
"""Build and verify the cumulative Android account-takeover APK."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import uuid
import zipfile
from pathlib import Path
from typing import Sequence


TARGET_SWF = "assets/worldflipper_android_release.swf"
MANIFEST = "AndroidManifest.xml"
BASE_APK_SHA256 = "07c316413e4e3f99dff83c52a5000f03ecbd466e76d5bc9f29fcd0884072de09"
BASE_SWF_SHA256 = "a354037c593f77773b3a0a18841fe4501cf55c1128bb1f89b0e47ad79dcfba60"
BASE_UNIQUE = "690fdca8-a0cf-4bf8-9241-733bcc7ed124"
LEGACY_V51_SWF_SHA256 = "eb7962184df5e7d1da112e4bef9ded8db8526e14a6f6f1710e051063a8f1d17c"
EXPECTED_CERTIFICATE_SHA256 = "569d19a3578d4cba16e3d6e7ad8ccab4fa667efc758deef6c9be3adb99919894"
SIGNATURE_SUFFIXES = (".SF", ".RSA", ".DSA", ".EC")

PUBLIC_EXPECTED_CHANGES_FROM_LEGACY_V51 = {
    "284:37085",
    "284:48482",
    "284:48484",
    "284:66481",
    "284:71113",
    "284:71115",
    "284:71120",
    "284:71122",
    "284:71123",
    "284:71132",
    "284:71143",
    "284:71162",
    "284:71163",
    "284:71167",
    "284:71189",
    "284:71203",
    "284:71207",
    "284:77176",
    "284:92013",
}

TAKEOVER_METHODS = (
    {
        "class_name": "pinball.scene.menuTop.MenuTopScene",
        "method_name": "createMenuListData",
        "body_index": 77176,
        "payload": "MenuTopScene-createMenuListData.pcode",
        "payload_sha256": "cb52389cb42b582a532c397ef0cac66ae24673c7dea74a8b7473a72419b08125",
    },
    {
        "class_name": "pinball.dialog.titleMenu.TitleMenuDialogContentView",
        "method_name": "setupContents",
        "body_index": 37085,
        "payload": "TitleMenuDialogContentView-setupContents.pcode",
        "payload_sha256": "eb24f215e36bb882baf32347c90d00cc7afcb1da74b636c03762ef84ca5d442c",
    },
)

PUBLIC_ENDPOINT_METHOD = {
    "class_name": "pinball.config.gbits.DevConfig_gf_android",
    "method_name": "<constructor>",
    "body_index": 92013,
    "payload": "DevConfig-gf-android-constructor-public-TEST-SERVER-HOST.pcode",
    "payload_sha256": "71b60aba2e4001e0617aa5c55b572889b7a9a1d53e60c89ee01087ee33d8025d",
}

COMMON_PRESERVED_METHODS = (
    ("pinball.scene.character.partyCarousel.PartyCarousel", "update", 66481),
    ("pinball.dialog.titleMenu.TitleMenuDialog", "prepare", 37071),
)

PROFILES = {
    "lan": {
        "patch_id": "android-account-takeover-entry-v2-lan-download-slot",
        "methods": TAKEOVER_METHODS,
        "preserved_methods": COMMON_PRESERVED_METHODS + (
            ("pinball.config.gbits.DevConfig_gf_android", "<constructor>", 92013),
        ),
        "endpoint": "approved LAN endpoint embedded in the exact base APK",
        "expected_swf_sha256": "b2c6cda47882ff4df6191b24c851c1eb05bcec16bc650a591853b4e715774c78",
    },
    "public": {
        "patch_id": "android-account-takeover-entry-v2-public-TEST-SERVER-HOST",
        "methods": TAKEOVER_METHODS + (PUBLIC_ENDPOINT_METHOD,),
        "preserved_methods": COMMON_PRESERVED_METHODS,
        "endpoint": "http://TEST-SERVER-HOST:8001",
        "expected_swf_sha256": "7eea1972f568e31ce5b708e057eb7fef306e2b25ba5cf7c6a198557914623ca7",
    },
}


class BuildError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(command: Sequence[str | Path], *, capture: bool = False) -> str:
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


def apksigner_command(java: Path, apksigner: Path, *args: str | Path) -> list[str | Path]:
    if apksigner.suffix.lower() == ".jar":
        return [java, "-jar", apksigner, *args]
    return [apksigner, *args]


def extract_member(apk: Path, member: str, output: Path) -> None:
    with zipfile.ZipFile(apk) as archive:
        matches = [item for item in archive.infolist() if item.filename == member]
        if len(matches) != 1:
            raise BuildError(f"expected one {member}, found {len(matches)}")
        output.write_bytes(archive.read(matches[0]))


def compile_method_tools(javac: Path, ffdec: Path, output: Path) -> None:
    source_root = Path(__file__).resolve().parents[1] / "character-carousel"
    output.mkdir(parents=True)
    run((
        javac,
        "-cp",
        ffdec,
        "-d",
        output,
        source_root / "FindMethodBody.java",
        source_root / "CompareMethodBodies.java",
    ))


def method_classpath(classes: Path, ffdec: Path) -> str:
    return os.pathsep.join((str(classes), str(ffdec)))


def find_method_bodies(
    swf: Path,
    methods: Sequence[tuple[str, str]],
    java: Path,
    ffdec: Path,
    classes: Path,
) -> dict[tuple[str, str], tuple[int, int]]:
    command: list[str | Path] = [
        java,
        "-cp",
        method_classpath(classes, ffdec),
        "FindMethodBody",
        swf,
    ]
    for class_name, method_name in methods:
        command.extend((class_name, method_name))
    output = run(command, capture=True)
    pattern = re.compile(r"^(.+)\tabc=(\d+)\tbody=(\d+)$")
    result: dict[tuple[str, str], tuple[int, int]] = {}
    for line in output.splitlines():
        match = pattern.fullmatch(line.strip())
        if match is None:
            continue
        label, abc_index, body_index = match.groups()
        candidates = [item for item in methods if f"{item[0]}.{item[1]}" == label]
        if len(candidates) != 1:
            raise BuildError(f"ambiguous method locator output: {line}")
        result[candidates[0]] = (int(abc_index), int(body_index))
    if set(result) != set(methods):
        raise BuildError(f"method locator result differs: {output}")
    return result


def compare_method_bodies(
    left: Path,
    right: Path,
    java: Path,
    ffdec: Path,
    classes: Path,
) -> set[str]:
    output = run((
        java,
        "-cp",
        method_classpath(classes, ffdec),
        "CompareMethodBodies",
        left,
        right,
    ), capture=True)
    count_match = re.search(r"^changed_count=(\d+)$", output, re.MULTILINE)
    changed_match = re.search(r"^changed=(.*)$", output, re.MULTILINE)
    if count_match is None or changed_match is None:
        raise BuildError(f"malformed method comparison: {output}")
    changed = {item for item in changed_match.group(1).split(",") if item}
    if int(count_match.group(1)) != len(changed):
        raise BuildError("method comparison count differs from its change set")
    return changed


def is_signature_member(name: str) -> bool:
    parts = name.split("/")
    if len(parts) != 2 or parts[0].upper() != "META-INF":
        return False
    upper = parts[1].upper()
    return upper == "MANIFEST.MF" or upper.endswith(SIGNATURE_SUFFIXES)


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


def verify_payload(base: Path, final: Path, intended_swf: Path, new_unique: str) -> dict:
    with zipfile.ZipFile(base) as source, zipfile.ZipFile(final) as target:
        source_map = {
            item.filename: item
            for item in source.infolist()
            if not is_signature_member(item.filename)
        }
        target_map = {
            item.filename: item
            for item in target.infolist()
            if not is_signature_member(item.filename)
        }
        if set(source_map) != set(target_map):
            raise BuildError("APK payload membership changed")
        for name in source_map:
            if name in {TARGET_SWF, MANIFEST}:
                continue
            if source.read(name) != target.read(name):
                raise BuildError(f"unrelated APK member changed: {name}")

        final_swf = target.read(TARGET_SWF)
        if hashlib.sha256(final_swf).hexdigest() != sha256_file(intended_swf):
            raise BuildError("signed APK contains the wrong SWF")

        base_manifest = source.read(MANIFEST)
        final_manifest = target.read(MANIFEST)
        old_bytes = BASE_UNIQUE.encode("utf-16le")
        new_bytes = new_unique.encode("utf-16le")
        if final_manifest.count(new_bytes) != 1 or final_manifest.count(old_bytes) != 0:
            raise BuildError("signed APK uniqueappversionid verification failed")
        if final_manifest.replace(new_bytes, old_bytes, 1) != base_manifest:
            raise BuildError("AndroidManifest.xml changed outside uniqueappversionid")

        return {
            "unrelated_members_preserved": len(source_map) - 2,
            "manifest_only_uniqueappversionid_changed": True,
            "injected_swf_sha256": hashlib.sha256(final_swf).hexdigest(),
            "uniqueappversionid": new_unique,
        }


def publish_no_replace(source: Path, target: Path) -> None:
    try:
        os.link(source, target)
    except FileExistsError as error:
        raise BuildError(f"output appeared during build: {target}") from error
    source.unlink()


def preflight(args: argparse.Namespace) -> None:
    profile = PROFILES[args.target]
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
        raise BuildError("output/report already exists; refusing to overwrite")
    if args.work.resolve().exists():
        raise BuildError("work directory already exists; refusing to reuse it")
    if args.password_env not in os.environ:
        raise BuildError(f"signing environment variable is missing: {args.password_env}")
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", args.password_env):
        raise BuildError("invalid signing environment variable name")
    if sha256_file(args.base.resolve()) != BASE_APK_SHA256:
        raise BuildError("base APK is not the approved LAN Rush APK")
    if args.target == "public":
        if args.legacy_feature_swf is None:
            raise BuildError("public build requires --legacy-feature-swf")
        if not args.legacy_feature_swf.resolve().is_file():
            raise BuildError(
                f"legacy feature SWF is not a file: {args.legacy_feature_swf}"
            )
        if sha256_file(args.legacy_feature_swf.resolve()) != LEGACY_V51_SWF_SHA256:
            raise BuildError("legacy feature SWF is not the approved V51 five-in-one baseline")

    root = Path(__file__).resolve().parent
    for method in profile["methods"]:
        payload = root / str(method["payload"])
        if not payload.is_file():
            raise BuildError(f"missing P-code payload: {payload}")
        if sha256_file(payload) != method["payload_sha256"]:
            raise BuildError(f"P-code payload hash differs: {payload}")


def build(args: argparse.Namespace) -> dict:
    preflight(args)
    profile = PROFILES[args.target]
    methods = profile["methods"]
    preserved_methods = profile["preserved_methods"]
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
    root = Path(__file__).resolve().parent

    output.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True)
    baseline_swf = work / "baseline.swf"
    patched_swf = work / "account-takeover.swf"
    classes = work / "method-tools"
    unsigned_apk = work / "unsigned.apk"
    aligned_apk = work / "aligned.apk"
    signed_stage = work / "signed.apk"
    final_swf = work / "signed-apk.swf"

    output_published = False
    report_published = False
    try:
        base_certificate = verify_apk(base, java, apksigner)
        extract_member(base, TARGET_SWF, baseline_swf)
        if sha256_file(baseline_swf) != BASE_SWF_SHA256:
            raise BuildError("approved base APK contains an unexpected SWF")

        compile_method_tools(javac, ffdec, classes)
        target_pairs = tuple(
            (str(item["class_name"]), str(item["method_name"])) for item in methods
        )
        preserved_pairs = tuple((item[0], item[1]) for item in preserved_methods)
        locations = find_method_bodies(
            baseline_swf,
            target_pairs + preserved_pairs,
            java,
            ffdec,
            classes,
        )
        for item in methods:
            key = (str(item["class_name"]), str(item["method_name"]))
            abc_index, body_index = locations[key]
            if abc_index != 284 or body_index != item["body_index"]:
                raise BuildError(f"unexpected target method location: {key} -> {locations[key]}")
        for class_name, method_name, expected_body in preserved_methods:
            if locations[(class_name, method_name)] != (284, expected_body):
                raise BuildError(f"unexpected preserved method location: {class_name}.{method_name}")

        source = baseline_swf
        previous_created: Path | None = None
        method_report: list[dict] = []
        for index, item in enumerate(methods, start=1):
            destination = work / f"method-stage-{index}.swf"
            key = (str(item["class_name"]), str(item["method_name"]))
            abc_index, body_index = locations[key]
            payload = root / str(item["payload"])
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
                key[0],
                payload,
                str(body_index),
            ))
            if previous_created is not None:
                previous_created.unlink()
            source = destination
            previous_created = destination
            method_report.append({
                "class_name": key[0],
                "method_name": key[1],
                "abc_index": abc_index,
                "body_index": body_index,
                "comparison_key": f"{abc_index}:{body_index}",
                "payload_sha256": sha256_file(payload),
            })
        if previous_created is None:
            raise BuildError("no method body was selected")
        os.replace(previous_created, patched_swf)

        actual_changes = compare_method_bodies(
            baseline_swf, patched_swf, java, ffdec, classes
        )
        expected_changes = {item["comparison_key"] for item in method_report}
        if actual_changes != expected_changes:
            raise BuildError(
                f"method-body change set differs: expected={sorted(expected_changes)} "
                f"actual={sorted(actual_changes)}"
            )
        expected_swf_sha256 = str(profile["expected_swf_sha256"])
        if sha256_file(patched_swf) != expected_swf_sha256:
            raise BuildError(
                "cumulative SWF hash differs from the accepted profile payload"
            )
        legacy_feature_report: dict | None = None
        if args.target == "public":
            assert args.legacy_feature_swf is not None
            legacy_feature_swf = args.legacy_feature_swf.resolve()
            legacy_changes = compare_method_bodies(
                legacy_feature_swf, patched_swf, java, ffdec, classes
            )
            if legacy_changes != PUBLIC_EXPECTED_CHANGES_FROM_LEGACY_V51:
                raise BuildError(
                    "V51 five-in-one/Fantasy lineage changed outside the approved "
                    f"cumulative methods: {sorted(legacy_changes)}"
                )
            legacy_feature_report = {
                "source_swf_sha256": sha256_file(legacy_feature_swf),
                "method_body_change_count": len(legacy_changes),
                "method_body_changes": sorted(legacy_changes),
                "fantasy_gauntlet_routing_battle_return_and_icon_fixes_preserved": True,
                "mod_character_five_in_one_preserved": True,
                "abyss_equipment_battle_gate_preserved": True,
                "seris_dual_form_pcode_preserved": True,
                "member_character_cell_and_pixel_art_scale_preserved": True,
            }

        new_unique = str(uuid.uuid4())
        if new_unique == BASE_UNIQUE:
            raise BuildError("new uniqueappversionid unexpectedly reused the baseline")
        repack_script = root.parent / "character-carousel" / "repack_apk_with_unique.py"
        run((
            sys.executable,
            "-X",
            "utf8",
            repack_script,
            base,
            patched_swf,
            unsigned_apk,
            "--expected-base-apk-sha256",
            BASE_APK_SHA256,
            "--expected-base-swf-sha256",
            BASE_SWF_SHA256,
            "--old-unique",
            BASE_UNIQUE,
            "--new-unique",
            new_unique,
        ))
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
            f"env:{args.password_env}",
            "--key-pass",
            f"env:{args.password_env}",
            "--out",
            signed_stage,
            aligned_apk,
        ))
        aligned_apk.unlink()
        run((zipalign, "-c", "-p", "4", signed_stage))
        certificate = verify_apk(signed_stage, java, apksigner)
        preservation = verify_payload(base, signed_stage, patched_swf, new_unique)
        extract_member(signed_stage, TARGET_SWF, final_swf)
        if compare_method_bodies(baseline_swf, final_swf, java, ffdec, classes) != expected_changes:
            raise BuildError("signed APK method-body change set differs")

        publish_no_replace(signed_stage, output)
        output_published = True
        report = {
            "schema_version": 1,
            "status": "locally_verified_test_candidate",
            "runtime_or_device_verified": False,
            "patch_id": profile["patch_id"],
            "target": args.target,
            "base_apk": {
                "path": str(base),
                "sha256": sha256_file(base),
                "swf_sha256": sha256_file(baseline_swf),
                "uniqueappversionid": BASE_UNIQUE,
            },
            "output_apk": {
                "path": str(output),
                "sha256": sha256_file(output),
                "swf_sha256": sha256_file(final_swf),
            },
            "method_body_transplants": method_report,
            "method_body_change_count": len(actual_changes),
            "method_body_changes": sorted(actual_changes),
            "preserved_lineage": {
                "character_carousel_update": "284:66481",
                "endpoint_constructor": "284:92013",
                "endpoint": profile["endpoint"],
                "title_menu_logic_prepare": "284:37071",
                "rush_leaderboard_inherited_from_exact_base_apk": True,
                "legacy_feature_guard": legacy_feature_report,
            },
            "title_menu_download_slot_replaced_by_takeover": True,
            "in_game_takeover_entry_added": True,
            "apk_payload": preservation,
            "zipalign_verified": True,
            "v1_signature_verified": True,
            "v2_signature_verified": True,
            "base_signer_certificate_sha256": base_certificate,
            "signer_certificate_sha256": certificate,
        }
        raw = (json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        with tempfile.NamedTemporaryFile(
            dir=report_path.parent,
            prefix=f".{report_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary_report = Path(handle.name)
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            publish_no_replace(temporary_report, report_path)
        finally:
            temporary_report.unlink(missing_ok=True)
        report_published = True
        return report
    except BaseException:
        if output_published:
            output.unlink(missing_ok=True)
        if report_published:
            report_path.unlink(missing_ok=True)
        raise
    finally:
        os.environ.pop(args.password_env, None)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--target",
        choices=tuple(PROFILES),
        default="lan",
        help="build the LAN takeover APK or the cumulative public APK",
    )
    parser.add_argument(
        "--legacy-feature-swf",
        type=Path,
        help=(
            "approved V51 five-in-one/Fantasy SWF; required for --target public "
            "so cumulative lineage can be checked"
        ),
    )
    parser.add_argument("--base", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path, dest="output")
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--work", required=True, type=Path)
    parser.add_argument("--ffdec", required=True, type=Path)
    parser.add_argument("--java", required=True, type=Path)
    parser.add_argument("--javac", required=True, type=Path)
    parser.add_argument("--zipalign", required=True, type=Path)
    parser.add_argument("--apksigner", required=True, type=Path)
    parser.add_argument("--ks", required=True, type=Path, dest="keystore")
    parser.add_argument("--ks-alias", required=True, dest="keystore_alias")
    parser.add_argument("--ks-pass-env", required=True, dest="password_env")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        report = build(args)
    except KeyboardInterrupt:
        print("[CANCELLED] APK build stopped.", file=sys.stderr)
        return 130
    except (BuildError, OSError, UnicodeError, zipfile.BadZipFile, subprocess.CalledProcessError) as error:
        print(f"[FAILED] {error}", file=sys.stderr)
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
