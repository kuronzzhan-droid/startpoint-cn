"""Read-only v33 DEX/package and R4 native applicability audit.

Only writes audit artifacts inside the task workspace. Does not invoke any APK
builder, signing tool, Android process, or network operation.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT / "audits"
APK = Path(r"D:\WF\MuMuPlayer\vms\MuMuPlayer-15.0-1\private_shared\wt_v33.apk")
SDK = Path(r"D:\WF\_archive\kept\AIRSDK_51.1.4.1")
JAVA = Path(r"D:\WF\runtimes\android-toolchain\jdk\jdk-17.0.19+10\bin\java.exe")
SOURCE = ROOT / "r4-src/client-patch/client-comprehensive/native/cn/startpoint/StartupCache.java"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    AUDIT.mkdir(exist_ok=True)
    temp = ROOT / "temp"
    temp.mkdir(exist_ok=True)
    env = dict(os.environ, TEMP=str(temp), TMP=str(temp),
               JAVA_TOOL_OPTIONS=f"-Djava.io.tmpdir={temp} -Duser.home={temp}")
    with zipfile.ZipFile(APK) as archive:
        dex_members = [name for name in archive.namelist()
                       if name.startswith("classes") and name.endswith(".dex")]
        dex_hashes = {name: sha(archive.read(name)) for name in dex_members}
        dex = archive.read("classes.dex")
        manifest = archive.read("AndroidManifest.xml")
    dex_path = AUDIT / "v33-classes.dex"
    dex_path.write_bytes(dex)
    output = AUDIT / "v33-dex-readback"
    command = [str(JAVA), "-jar", str(SDK / "lib/android/lib/baksmali.jar"),
               "disassemble", str(dex_path), "-o", str(output)]
    result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True)
    (AUDIT / "native-dex-readback.log").write_text(
        result.stdout + result.stderr, encoding="utf-8")
    if result.returncode:
        raise RuntimeError(f"baksmali failed: {result.returncode}")
    source_text = SOURCE.read_text(encoding="utf-8")
    targets = sorted(output.glob("cn/startpoint/StartupCache*.smali"))
    evidence = {}
    for path in targets:
        text = path.read_text(encoding="utf-8")
        evidence[path.relative_to(ROOT).as_posix()] = {
            "sha256": sha(path.read_bytes()),
            "wf_guard_line_numbers": [i for i, line in enumerate(text.splitlines(), 1)
                                      if '"com.leiting.wf"' in line],
            "wt_literal_count": text.count('"com.leiting.wt"'),
            "deferred_policy_literal": "deferred-until-next-launch" in text,
            "periodic_purge_present": "periodicPurge" in text,
        }
    info = {
        "status": "excluded_from_v34",
        "input_apk": str(APK),
        "input_apk_sha256": sha(APK.read_bytes()),
        "all_dex_members_sha256": dex_hashes,
        "manifest_utf16_package_wt_occurrences": manifest.count("com.leiting.wt".encode("utf-16le")),
        "v33_startup_cache_classes": evidence,
        "r4_source": str(SOURCE.relative_to(ROOT)),
        "r4_source_sha256": sha(SOURCE.read_bytes()),
        "r4_wf_guard_line_numbers": [i for i, line in enumerate(source_text.splitlines(), 1)
                                      if '"com.leiting.wf"' in line],
        "r4_wt_literal_count": source_text.count('"com.leiting.wt"'),
        "applicability": "R4 run() returns before clean()/startPeriodic() for com.leiting.wt; clean() independently requires dataDir basename com.leiting.wf.",
        "decision_reasons": [
            "Unmodified R4 native helper is inactive for com.leiting.wt.",
            "v33 has only StartupCache, no StartupCache$Periodic class or periodicPurge method; the upstream live-periodic-deletion behavior targeted by R4 is absent from this input.",
            "Changing package guards and replacing Java/DEX helper classes is outside the task's method-level AVM2 P-code splice boundary.",
            "R4 build_apk.py recompiles and replaces native helper classes, changes AIR identity, and signs; the task requires preserving v33 AIR identity and unsigned output.",
            "No Java/DEX/native modification performed; v34 must preserve every v33 DEX member byte-for-byte.",
        ],
        "tools": {
            "java": str(JAVA),
            "javac": str(JAVA.with_name("javac.exe")),
            "zipalign": r"D:\WF\runtimes\android-toolchain\sdk\build-tools\34.0.0\zipalign.exe",
            "alternate_zipalign": r"C:\Program Files (x86)\Android\android-sdk\build-tools\35.0.0\zipalign.exe",
            "ffdec": r"D:\WF\outputs\re-workspace\ffdec_26.2.1\ffdec.jar",
            "air_sdk": str(SDK),
            "air_sdk_description": (SDK / "air-sdk-description.xml").read_text(encoding="utf-8"),
            "compc": str(SDK / "lib/compc-cli.jar"),
            "mxmlc": str(SDK / "lib/mxmlc-cli.jar"),
            "adl": str(SDK / "bin/adl.exe"),
            "required_r4_sdk": "51.2.1.5",
            "required_r4_sdk_found": False,
            "tool_existence": {str(p): p.is_file() for p in [JAVA, JAVA.with_name("javac.exe"),
                SDK / "lib/compc-cli.jar", SDK / "lib/mxmlc-cli.jar", SDK / "bin/adl.exe"]},
        },
        "validation_scope": "Offline source and v33 DEX readback only; no Android runtime/native acceptance, no signing, no install.",
        "run_native_tests": "not run: native change excluded from v34",
        "execution_write_confinement": "Run python -B with PYTHONIOENCODING=utf-8, TEMP/TMP=<workspace>/temp and JAVA_TOOL_OPTIONS=-Djava.io.tmpdir=<workspace>/temp -Duser.home=<workspace>/temp. All explicit output paths must be under workspace.",
    }
    (AUDIT / "native-audit.json").write_text(json.dumps(info, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": info["status"], "dex": dex_hashes,
                      "smali_classes": list(evidence)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
