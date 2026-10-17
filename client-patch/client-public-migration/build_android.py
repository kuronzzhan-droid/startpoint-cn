"""Convert the pinned R4 LAN APK to a public Android APK with a new admission pair.

The input is an existing signed APK. Only SWF string-pool constants, the AIR
UUID in AndroidManifest.xml and classes.dex, and signing records may change.
This script never prints or copies the admission key or signing password.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
import re
import struct
import subprocess
import uuid
import zipfile
import zlib
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent.parent
SIGN_SCRIPT = ROOT / "lens0907-0908/sign_apk.ps1"
SWF_MEMBER = "assets/worldflipper_android_release.swf"
SIGNATURES = {"META-INF/MANIFEST.MF", "META-INF/WF.SF", "META-INF/WF.RSA"}
SIGNER_SHA = "569d19a3578d4cba16e3d6e7ad8ccab4fa667efc758deef6c9be3adb99919894"
# R4 string layout guards. Change only after inspecting a newly accepted LAN
# artifact; the ABC/body counts themselves come from its acceptance record.
EXPECTED_HOST_STRINGS = 9
EXPECTED_ID_STRINGS = 3
EXPECTED_KEY_STRINGS = 2


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


swf_tools = load("r4_public_swf", ROOT / "startup-cache/build_swf.py")
lan_tools = load("r4_public_lan", ROOT / "r10-public-release/build_lan.py")
native_tools = load("r4_public_native", ROOT / "startup-cache/verify_native.py")
baseline = load("r4_public_baseline", ROOT / "verify_android_baseline.py")
quiet = load("r4_public_quiet", ROOT / "quiet_process.py")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def run(command: list[object], cwd: Path, label: str) -> str:
    result = quiet.run([str(item) for item in command], cwd=cwd,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            timeout=600, check=False)
    output = result.stdout.decode("utf-8", "replace")
    # Tool output is retained locally. The signing script does not echo its
    # process-scoped DPAPI secret, and its output is not included in the report.
    (cwd / f"{label}.log").write_text(output, encoding="utf-8")
    if result.returncode:
        raise RuntimeError(f"{label} failed (exit {result.returncode}); see local log")
    return output


def smali_map(directory: Path) -> dict[str, str]:
    return {p.relative_to(directory).as_posix(): p.read_text("utf-8")
            for p in directory.rglob("*.smali")}


def require_restricted_acl(directory: Path) -> None:
    """Reject broad Windows ACLs before writing an extracted SWF or APK."""
    script = r"""
    $acl = Get-Acl -LiteralPath $env:SP_PRIVATE_SCRATCH
    $self = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $allowed = @($self, 'S-1-5-18', 'S-1-5-32-544')
    foreach ($rule in $acl.Access) {
        try { $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value }
        catch { exit 2 }
        if ($sid -notin $allowed) { exit 3 }
    }
    """
    environment = dict(os.environ, SP_PRIVATE_SCRATCH=str(directory))
    result = quiet.run(["powershell", "-NoProfile", "-NonInteractive",
                             "-Command", script], env=environment,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            check=False)
    if result.returncode:
        raise PermissionError("scratch directory ACL must allow only current user, SYSTEM and Administrators")


def origin_netloc(value: str) -> str:
    parts = urlsplit(value)
    if (parts.scheme != "http" or not parts.hostname or parts.port != 8001
            or parts.path not in ("", "/") or parts.query or parts.fragment
            or parts.username or parts.password):
        raise ValueError("origin must be a plain HTTP host on port 8001")
    return parts.netloc


def rewrite_swf(input_swf: bytes, new_id: str, keys: dict[str, str],
                target_origin: str, scratch: Path, expected_abcs: int,
                expected_bodies: int) -> tuple[bytes, dict]:
    input_path = scratch / "input.swf"
    input_path.write_bytes(input_swf)
    version, header, tags = swf_tools.parts(input_path)
    abcs = [tag for tag in tags if tag[0] == 82]
    if len(abcs) != expected_abcs or sum(len(t[3].bodies) for t in abcs) != expected_bodies:
        raise AssertionError("accepted ABC/body inventory mismatch")
    constants = lan_tools.constants(abcs)
    old_id, old_key, source_origin = (constants[k] for k in ("ID", "KEY", "ORIGIN"))
    if not old_id.startswith("android-") or not re.fullmatch(r"[0-9a-fA-F]{64}", old_key):
        raise AssertionError("input Android admission identity has an invalid format")
    if keys.get(old_id) != old_key:
        raise AssertionError("actual input admission key differs from the restricted pair")
    old_host_port = origin_netloc(source_origin).encode()
    new_host_port = origin_netloc(target_origin).encode()
    if old_host_port == new_host_port or old_id == new_id:
        raise ValueError("public origin and admission ID must differ from input")
    new_key = keys[new_id]

    old_id_bytes = old_id.encode()
    old_challenge = ("SP-ADMISSION-1\n" + old_id + "\n").encode()
    changed_tags = []
    count_host = count_id = count_key = count_challenge = 0
    patches_by_tag: dict[int, dict[int, tuple[bytes, bytes]]] = {}
    for tag_index, tag in enumerate(tags):
        if tag[0] != 82:
            continue
        patches = {}
        for index, value in enumerate(tag[3].strings):
            if not isinstance(value, bytes):
                continue
            after = value
            if old_host_port in after:
                after = after.replace(old_host_port, new_host_port)
                count_host += 1
            if after == old_id_bytes:
                after = new_id.encode()
                count_id += 1
            elif after == old_challenge:
                after = ("SP-ADMISSION-1\n" + new_id + "\n").encode()
                count_challenge += 1
            elif after == old_key.encode():
                after = new_key.encode()
                count_key += 1
            if after != value:
                patches[index] = (value, after)
        if patches:
            replacement = lan_tools.patch_strings(tag[4], patches)
            inverse = {index: (after, before) for index, (before, after) in patches.items()}
            if lan_tools.patch_strings(replacement, inverse) != tag[4]:
                raise AssertionError("ABC reverse patch failed")
            payload = tag[2] + replacement
            tag[1] = struct.pack("<HI", (82 << 6) | 63, len(payload)) + payload
            patches_by_tag[tag_index] = patches
            changed_tags.append(tag_index)
    if (count_host, count_id, count_key, count_challenge) != (
            EXPECTED_HOST_STRINGS, EXPECTED_ID_STRINGS - 1, EXPECTED_KEY_STRINGS, 1):
        raise AssertionError("unexpected address or admission string inventory")
    # ID appears twice as a direct constant and once in the challenge prefix.
    if count_id + count_challenge != EXPECTED_ID_STRINGS:
        raise AssertionError("admission ID occurrence count mismatch")

    raw = header + b"".join(tag[1] for tag in tags)
    output = b"CWS" + bytes([version]) + struct.pack("<I", len(raw) + 8) + zlib.compress(raw)
    output_path = scratch / "public.swf"
    output_path.write_bytes(output)
    _, _, readback = swf_tools.parts(output_path)
    _, _, original = swf_tools.parts(input_path)
    if len(readback) != len(original):
        raise AssertionError("SWF tag inventory changed")
    for index, (before, after) in enumerate(zip(original, readback)):
        patches = patches_by_tag.get(index)
        if patches is None:
            if before[1] != after[1]:
                raise AssertionError("non-target SWF tag changed")
        else:
            inverse = {i: (new, old) for i, (old, new) in patches.items()}
            if lan_tools.patch_strings(after[4], inverse) != before[4]:
                raise AssertionError("SWF method/trait preservation check failed")
    actual = lan_tools.constants([t for t in readback if t[0] == 82])
    if actual != {"ID": new_id, "KEY": new_key, "ORIGIN": target_origin}:
        raise AssertionError("public admission constants did not round-trip")
    if any(old_host_port in item for t in readback if t[0] == 82 for item in t[3].strings):
        raise AssertionError("input address remains in SWF")
    return output, {"previous_admission_id": old_id,
                    "changed_tags": changed_tags, "address_strings": count_host,
                    "admission_id_strings": count_id + count_challenge,
                    "admission_key_strings": count_key,
                    "method_bodies": expected_bodies, "methods_and_traits_preserved": True}


def rewrite_dex(input_dex: bytes, old_uuid: str, new_uuid: str,
                scratch: Path, java: Path, libs: Path) -> bytes:
    old_dex = scratch / "input.dex"
    old_dex.write_bytes(input_dex)
    smali = scratch / "smali"
    readback = scratch / "smali-readback"
    run([java, "-jar", libs / "baksmali.jar", "d", "-o", smali, old_dex], scratch, "dex-decode")
    original = smali_map(smali)
    changed = {}
    for name, value in original.items():
        hits = value.count(old_uuid)
        if hits:
            changed[name] = hits
            (smali / name).write_text(value.replace(old_uuid, new_uuid), "utf-8")
    if changed != {"cn/startpoint/BuildIdentity.smali": 1,
                   "cn/startpoint/StartupCache.smali": 1}:
        raise AssertionError("native AIR identity sites changed")
    new_dex = scratch / "classes.dex"
    run([java, "-jar", libs / "smali.jar", "a", "-a", "21", "-o", new_dex, smali], scratch, "dex-assemble")
    run([java, "-jar", libs / "baksmali.jar", "d", "-o", readback, new_dex], scratch, "dex-readback")
    final = smali_map(readback)
    if set(final) != set(original):
        raise AssertionError("DEX class inventory changed")
    for name, value in original.items():
        comparison = final[name].replace(new_uuid, old_uuid)
        if native_tools.canonical(comparison) != native_tools.canonical(value):
            raise AssertionError("non-UUID native logic changed")
    data = new_dex.read_bytes()
    if old_uuid.encode() in data or data.count(new_uuid.encode()) != 1:
        raise AssertionError("DEX AIR identity did not round-trip")
    return data


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--record", type=Path, default=ROOT / "android-accepted.json")
    parser.add_argument("--input-apk", type=Path, help="alternate path; must match accepted LAN identity")
    parser.add_argument("--output-apk", type=Path, required=True)
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--admission-id", required=True)
    parser.add_argument("--keys-file", type=Path, required=True)
    parser.add_argument("--new-uuid", required=True)
    parser.add_argument("--target-origin", required=True)
    parser.add_argument("--java", type=Path, required=True)
    parser.add_argument("--android-lib", type=Path, required=True)
    parser.add_argument("--build-tools", type=Path, required=True)
    args = parser.parse_args()
    new_uuid = str(uuid.UUID(args.new_uuid))
    if new_uuid != args.new_uuid.lower():
        raise ValueError("new UUID must be canonical")
    if not re.fullmatch(r"android-[a-zA-Z0-9-]{8,80}", args.admission_id):
        raise ValueError("invalid Android admission ID format")
    origin_netloc(args.target_origin)
    if args.target_origin.endswith("/"):
        raise ValueError("target origin must not end with a slash")
    record_path = args.record.resolve(strict=True)
    record = json.loads(record_path.read_text("utf-8"))
    entry = record["variants"]["lan"]
    input_apk = (args.input_apk if args.input_apk else ROOT.parent / entry["apk"]).resolve(strict=True)
    accepted = baseline.verify("lan", input_apk, record_path=record_path)
    old_uuid = accepted["uniqueappversionid"]
    if new_uuid == old_uuid:
        raise ValueError("new UUID must differ from accepted LAN input")
    expected_abcs = entry["main_abc_index"] + 1
    expected_bodies = entry["local_build_checks"]["total_method_bodies"]
    output_apk = args.output_apk.resolve(strict=False)
    scratch = args.scratch.resolve(strict=False)
    keys_path = args.keys_file.resolve(strict=True)
    repository = ROOT.parent
    if any(path.is_relative_to(repository) for path in (output_apk, scratch, keys_path)):
        raise ValueError("output, scratch and admission keys must be outside the Git repository")
    require_restricted_acl(keys_path)
    if not scratch.parent.is_dir():
        raise FileNotFoundError("restricted scratch parent must already exist")
    require_restricted_acl(scratch.parent)
    if output_apk.exists() or scratch.exists():
        raise FileExistsError("output APK and scratch directory must be new")
    keys = json.loads(keys_path.read_text("utf-8-sig"))
    if not isinstance(keys, dict) or args.admission_id not in keys:
        raise AssertionError("new Android key missing from restricted pair")
    if not isinstance(keys[args.admission_id], str) or not re.fullmatch(r"[0-9a-fA-F]{64}", keys[args.admission_id]):
        raise AssertionError("new admission key format mismatch")
    scratch.mkdir()
    require_restricted_acl(scratch)
    output_apk.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(input_apk) as source:
        if source.testzip() is not None:
            raise AssertionError("input APK ZIP integrity failed")
        entries = [(copy.copy(info), source.read(info.filename)) for info in source.infolist()]
    source_map = {info.filename: data for info, data in entries}
    if len(source_map) != len(entries) or sha(source_map[SWF_MEMBER]) != accepted["swf_sha256"]:
        raise AssertionError("accepted LAN member identity changed")
    manifest = source_map["AndroidManifest.xml"]
    if manifest.count(old_uuid.encode("utf-16le")) != 1:
        raise AssertionError("accepted AIR manifest identity mismatch")
    swf, swf_report = rewrite_swf(source_map[SWF_MEMBER], args.admission_id,
                                  keys, args.target_origin, scratch,
                                  expected_abcs, expected_bodies)
    old_id = swf_report["previous_admission_id"]
    if old_id not in keys or keys[old_id] == keys[args.admission_id]:
        raise AssertionError("old and new Android admission pairs must differ")
    java = args.java.resolve(strict=True)
    libs = args.android_lib.resolve(strict=True)
    tools = args.build_tools.resolve(strict=True)
    dex = rewrite_dex(source_map["classes.dex"], old_uuid, new_uuid, scratch, java, libs)
    payloads = {SWF_MEMBER: swf, "classes.dex": dex,
                "AndroidManifest.xml": manifest.replace(old_uuid.encode("utf-16le"),
                                                       new_uuid.encode("utf-16le"))}
    unsigned = scratch / "unsigned.apk"
    with zipfile.ZipFile(unsigned, "w", allowZip64=True) as dest:
        for info, data in entries:
            if info.filename not in SIGNATURES:
                dest.writestr(info, payloads.get(info.filename, data))
    aligned = scratch / "aligned.apk"
    run([tools / "zipalign.exe", "-p", "4", unsigned, aligned], scratch, "align")
    run(["powershell", "-NoProfile", "-NonInteractive", "-File", SIGN_SCRIPT,
         "-InputApk", aligned, "-OutputApk", output_apk,
         "-ApkSigner", tools / "lib/apksigner.jar", "-Java", java], scratch, "sign")
    signature = run([java, "-jar", tools / "lib/apksigner.jar", "verify",
                     "--verbose", "--print-certs", output_apk], scratch, "signature-verify")
    if SIGNER_SHA not in signature.lower() or any(
        "Verified using " + scheme + ": true" not in signature for scheme in
        ("v1 scheme (JAR signing)", "v2 scheme (APK Signature Scheme v2)")):
        raise AssertionError("signature identity or scheme mismatch")
    run([tools / "zipalign.exe", "-c", "-p", "4", output_apk], scratch, "alignment-verify")
    with zipfile.ZipFile(output_apk) as final:
        if final.testzip() is not None:
            raise AssertionError("output APK ZIP integrity failed")
        final_names = final.namelist()
        if set(final_names) - SIGNATURES != set(source_map) - SIGNATURES:
            raise AssertionError("APK member inventory changed")
        for name, original in source_map.items():
            if name not in SIGNATURES and final.read(name) != payloads.get(name, original):
                raise AssertionError("APK member changed unexpectedly")
        if final.read("AndroidManifest.xml").count(new_uuid.encode("utf-16le")) != 1:
            raise AssertionError("output manifest AIR UUID mismatch")
    report = {"status": "offline_public_candidate", "input_apk": str(input_apk),
              "input_apk_sha256": accepted["apk_sha256"],
              "input_swf_sha256": accepted["swf_sha256"],
              "output_apk": str(output_apk), "output_apk_sha256": sha(output_apk.read_bytes()),
              "output_swf_sha256": sha(swf), "endpoint": args.target_origin,
              "admission_id": args.admission_id,
              "previous_uuid": old_uuid, "uniqueappversionid": new_uuid,
              "signer_certificate_sha256": SIGNER_SHA, "signature_v1_v2": True,
              "zipalign": True, "non_target_apk_members_unchanged": True,
              "native_logic_unchanged": True, "device_tested": False,
              **swf_report}
    receipt = output_apk.with_suffix(".verification.json")
    receipt.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", "utf-8")
    output_apk.with_suffix(".sha256.txt").write_text(
        report["output_apk_sha256"] + "  " + output_apk.name + "\n", "ascii")
    print(json.dumps({"status": report["status"], "output_apk": str(output_apk),
                      "output_apk_sha256": report["output_apk_sha256"],
                      "admission_id": args.admission_id, "uniqueappversionid": new_uuid},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
