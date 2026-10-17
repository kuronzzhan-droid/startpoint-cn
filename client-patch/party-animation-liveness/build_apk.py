"""Package an audited party SWF on the registered Android LAN baseline.

This entry only changes the SWF and the paired AIR cache identities. It never
installs an APK, edits admission configuration, or promotes an accepted record.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import uuid
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PATCH_ROOT = HERE.parent
BASE_APK_SHA256 = "4f62b899a89b0648f79d0dbaf20d8aab9b64ad91959d91706dc71af02cb6c335"
BASE_SWF_SHA256 = "9418137820c007b52a11ad0d7955c102795d8dd903213670577bf3407ed709f7"
CERT = "569d19a3578d4cba16e3d6e7ad8ccab4fa667efc758deef6c9be3adb99919894"
SWF_MEMBER = "assets/worldflipper_android_release.swf"
SIGNATURE_MEMBERS = {"META-INF/MANIFEST.MF", "META-INF/WF.SF", "META-INF/WF.RSA"}
IDENTITY_CLASSES = {"cn/startpoint/StartupCache.smali", "cn/startpoint/BuildIdentity.smali"}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def run(command: list[object], work: Path, label: str, timeout: int = 180) -> str:
    result = subprocess.run([str(x) for x in command], cwd=work,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            timeout=timeout, check=False)
    text = result.stdout.decode("utf-8", "replace")
    (work / (label + ".log")).write_text(text, encoding="utf-8")
    if result.returncode:
        raise RuntimeError(f"{label} failed ({result.returncode}):\n{text[-4000:]}")
    return text


def read_smali(root: Path) -> dict[str, str]:
    return {p.relative_to(root).as_posix(): p.read_text(encoding="utf-8")
            for p in root.rglob("*.smali")}


def package(args: argparse.Namespace) -> dict:
    record = json.loads(args.registry.read_text(encoding="utf-8"))
    entry = record["lineage"]["previous_android_variants"]["lan"]
    if entry["apk_sha256"] != BASE_APK_SHA256 or entry["swf_sha256"] != BASE_SWF_SHA256:
        raise ValueError("LAN registry changed; re-audit before selecting a new input")
    source_path = Path(args.input_apk or entry["apk"])
    if not source_path.is_absolute():
        source_path = PATCH_ROOT.parent / source_path
    if args.work.exists() or args.output_apk.exists():
        raise FileExistsError("build work directory and output APK must be new")
    for path in (args.work, args.output_apk):
        if ".cdn" in path.resolve().parts:
            raise ValueError("CDN baseline is not a build/output directory")
    if sha(source_path.read_bytes()) != BASE_APK_SHA256:
        raise ValueError("actual input APK differs from the audited LAN baseline")
    candidate_swf = args.swf.read_bytes()
    if sha(candidate_swf) != args.expected_swf_sha256 or sha(candidate_swf) == BASE_SWF_SHA256:
        raise ValueError("candidate SWF does not match the audited changed payload")
    for tool in (args.java, args.java.with_name("javac.exe"), args.ffdec,
                 args.baksmali, args.smali, args.apksigner, args.zipalign, args.sign_script):
        if not tool.is_file():
            raise FileNotFoundError(tool)
    args.work.mkdir(parents=True)
    args.output_apk.parent.mkdir(parents=True, exist_ok=True)
    old_uuid = entry["uniqueappversionid"]
    new_uuid = str(uuid.uuid4())
    with zipfile.ZipFile(source_path) as source:
        if len(source.namelist()) != len(set(source.namelist())):
            raise ValueError("duplicate source APK members")
        original_swf = source.read(SWF_MEMBER)
        original_dex = source.read("classes.dex")
        original_manifest = source.read("AndroidManifest.xml")
    if sha(original_swf) != BASE_SWF_SHA256 or sha(original_dex) != entry["dex_sha256"]:
        raise ValueError("embedded source payload identity differs")
    if original_manifest.count(old_uuid.encode("utf-16le")) != 1:
        raise ValueError("manifest must contain the baseline AIR UUID exactly once")
    (args.work / "baseline.swf").write_bytes(original_swf)
    classes = args.work / "java"
    classes.mkdir()
    run([args.java.with_name("javac.exe"), "-cp", args.ffdec, "-d", classes,
         PATCH_ROOT / "character-carousel/CompareMethodBodies.java"], args.work, "compile-verifier")
    compared = run([args.java, "-Xmx2g", "-cp", str(classes) + ";" + str(args.ffdec),
                    "CompareMethodBodies", args.work / "baseline.swf", args.swf], args.work, "method-readback")
    changed_match = re.search(r"^changed=(.*)$", compared, re.MULTILINE)
    if not changed_match:
        raise ValueError("independent method comparison did not report a change set")
    changed = set(changed_match.group(1).strip().split(","))
    expected = set(args.expected_method)
    if changed != expected or "method_bodies=96706" not in compared:
        raise ValueError(f"unexpected method inventory/change set: {sorted(changed)}")
    (args.work / "baseline.dex").write_bytes(original_dex)
    smali_dir, readback_dir = args.work / "smali", args.work / "readback"
    run([args.java, "-jar", args.baksmali, "d", "-o", smali_dir,
         args.work / "baseline.dex"], args.work, "dex-decode")
    original_classes = read_smali(smali_dir)
    uuid_sites = {name for name, text in original_classes.items() if old_uuid in text}
    if uuid_sites != IDENTITY_CLASSES:
        raise ValueError(f"unexpected native AIR identity classes: {sorted(uuid_sites)}")
    for name in IDENTITY_CLASSES:
        if original_classes[name].count(old_uuid) != 1:
            raise ValueError(f"unexpected UUID count: {name}")
        (smali_dir / name).write_text(original_classes[name].replace(old_uuid, new_uuid), encoding="utf-8")
    dex_path = args.work / "classes.dex"
    run([args.java, "-jar", args.smali, "a", "-a", "21", "-o", dex_path,
         smali_dir], args.work, "dex-assemble")
    run([args.java, "-jar", args.baksmali, "d", "-o", readback_dir,
         dex_path], args.work, "dex-readback")
    after_classes = read_smali(readback_dir)
    if after_classes.keys() != original_classes.keys():
        raise ValueError("DEX class inventory changed")
    for name, before in original_classes.items():
        after = after_classes[name]
        if name in IDENTITY_CLASSES:
            after = after.replace(new_uuid, old_uuid)
        if after != before:
            raise ValueError(f"native behavior changed outside cache identity: {name}")
    if old_uuid.encode() in dex_path.read_bytes():
        raise ValueError("old AIR UUID remains in DEX")
    payloads = {SWF_MEMBER: candidate_swf, "classes.dex": dex_path.read_bytes(),
                "AndroidManifest.xml": original_manifest.replace(old_uuid.encode("utf-16le"), new_uuid.encode("utf-16le"))}
    unsigned, aligned = args.work / "unsigned.apk", args.work / "aligned.apk"
    with zipfile.ZipFile(source_path) as source, zipfile.ZipFile(unsigned, "w") as target:
        for info in source.infolist():
            if info.filename not in SIGNATURE_MEMBERS:
                target.writestr(info, payloads[info.filename] if info.filename in payloads else source.read(info.filename))
    run([args.zipalign, "-p", "4", unsigned, aligned], args.work, "align")
    run(["powershell", "-NoProfile", "-NonInteractive", "-File", args.sign_script,
         "-InputApk", aligned, "-OutputApk", args.output_apk,
         "-ApkSigner", args.apksigner, "-Java", args.java], args.work, "sign")
    signature = run([args.java, "-jar", args.apksigner, "verify", "--verbose", "--print-certs",
                     args.output_apk], args.work, "signature-readback")
    for scheme in ("v1 scheme (JAR signing)", "v2 scheme (APK Signature Scheme v2)"):
        if f"Verified using {scheme}: true" not in signature:
            raise ValueError(f"signature verification failed: {scheme}")
    if CERT not in signature.lower():
        raise ValueError("signer does not match the required StarPoint CN identity")
    run([args.zipalign, "-c", "-p", "4", args.output_apk], args.work, "alignment-readback")
    preserved = 0
    with zipfile.ZipFile(source_path) as source, zipfile.ZipFile(args.output_apk) as target:
        if target.testzip() is not None or len(target.namelist()) != len(set(target.namelist())):
            raise ValueError("candidate APK ZIP integrity failed")
        if set(target.namelist()) - SIGNATURE_MEMBERS != set(source.namelist()) - SIGNATURE_MEMBERS:
            raise ValueError("APK member inventory changed")
        for name in source.namelist():
            if name in SIGNATURE_MEMBERS:
                continue
            expected_bytes = payloads[name] if name in payloads else source.read(name)
            if target.read(name) != expected_bytes:
                raise ValueError(f"unexpected APK member change: {name}")
            if name not in payloads:
                preserved += 1
        manifest = target.read("AndroidManifest.xml")
        if manifest.count(new_uuid.encode("utf-16le")) != 1 or old_uuid.encode("utf-16le") in manifest:
            raise ValueError("final AIR manifest identity is not fresh and unique")
    report = {
        "status": "offline_candidate", "variant": "lan", "apk": str(args.output_apk),
        "input_apk_sha256": BASE_APK_SHA256, "apk_sha256": sha(args.output_apk.read_bytes()),
        "input_swf_sha256": BASE_SWF_SHA256, "swf_sha256": sha(candidate_swf),
        "method_bodies_compared": 96706, "changed_methods": sorted(changed),
        "uniqueappversionid": new_uuid, "previous_uniqueappversionid": old_uuid,
        "native_behavior_preserved_except_identity": True, "preserved_apk_members": preserved,
        "package_and_version_identity_preserved": True, "signer_certificate_sha256": CERT,
        "zipalign": True, "v1_signature": True, "v2_signature": True,
        "admission_pair_changed": False, "resources_changed": False,
        "device_tested": False, "registry_promoted": False,
        "server_changed": False, "ios_changed": False
    }
    args.output_apk.with_suffix(".verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.output_apk.with_suffix(".sha256.txt").write_text(report["apk_sha256"] + "  " + args.output_apk.name + "\n", encoding="ascii")
    return report


def main() -> None:
    sdk = Path(os.environ.get("STARPOINT_AIR_SDK", "AIRSDK_51.2.1.5"))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=PATCH_ROOT / "android-accepted.json")
    parser.add_argument("--input-apk", type=Path, help="audited pre-R4 LAN APK")
    parser.add_argument("--swf", type=Path, required=True)
    parser.add_argument("--expected-swf-sha256", required=True)
    parser.add_argument("--expected-method", action="append", required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--output-apk", type=Path, required=True)
    parser.add_argument("--java", type=Path, default=Path(os.environ.get("STARPOINT_JAVA", "java")))
    parser.add_argument("--ffdec", type=Path, default=Path(os.environ.get("STARPOINT_FFDEC_JAR", "ffdec.jar")))
    parser.add_argument("--baksmali", type=Path, default=sdk / "lib/android/lib/baksmali.jar")
    parser.add_argument("--smali", type=Path, default=sdk / "lib/android/lib/smali.jar")
    parser.add_argument("--apksigner", type=Path, default=sdk / "lib/android/lib/apksigner.jar")
    parser.add_argument("--zipalign", type=Path, default=Path(os.environ.get("STARPOINT_ZIPALIGN", "zipalign")))
    parser.add_argument("--sign-script", type=Path, default=PATCH_ROOT / "lens0907-0908/sign_apk.ps1")
    print(json.dumps(package(parser.parse_args()), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
