"""Rebuild the fixed R4 LAN SWF from the audited pre-R4 Android package."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import zipfile
from pathlib import Path

import importlib.util

from verify_swf import verify

HERE = Path(__file__).resolve().parent
PATCH_ROOT = HERE.parent
REPO_ROOT = PATCH_ROOT.parent
_quiet_spec = importlib.util.spec_from_file_location("comprehensive_quiet_process", PATCH_ROOT / "quiet_process.py")
quiet = importlib.util.module_from_spec(_quiet_spec)
sys.modules[_quiet_spec.name] = quiet
_quiet_spec.loader.exec_module(quiet)
BASE_APK_SHA256 = "4f62b899a89b0648f79d0dbaf20d8aab9b64ad91959d91706dc71af02cb6c335"
BASE_SWF_SHA256 = "9418137820c007b52a11ad0d7955c102795d8dd903213670577bf3407ed709f7"
FINAL_SWF_SHA256 = "3f37dee12692b53cd6f9db0a21ec826366d56b8338cdfa66216fc7dbc2efde37"
DATA_HELPER_SHA256 = "acfe2f76f4a746f66dbf2b30dcbc6b05528257fceb21fad5d0a7dd5c48bf30dc"
SWF_MEMBER = "assets/worldflipper_android_release.swf"
HELPERS = {
    "cn/optimize/network/RequestTimer",
    "cn/optimize/network/NetworkBudget",
    "cn.optimize.data.DataOptimization",
    "cn.optimize.resources.ResourceRuntime",
    "cn.optimize.ui.UiOptimization",
}
STAGES = (
    ("liveness", "party-animation-liveness/patch_swf.py"),
    ("refresh", "party-refresh-performance/patch_swf.py"),
    ("network", "client-network-optimization/patch_swf.py"),
    ("data", "client-data-optimization/patch_swf.py"),
    ("resource", "client-resource-optimization/patch_swf.py"),
    ("ui", "client-ui-optimization/patch_swf.py"),
)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def previous_lan(registry: Path) -> dict:
    record = json.loads(registry.read_text(encoding="utf-8"))
    previous = record["lineage"]["previous_android_variants"]["lan"]
    assert previous["apk_sha256"] == BASE_APK_SHA256
    assert previous["swf_sha256"] == BASE_SWF_SHA256
    assert record["variants"]["lan"]["apk_sha256"] != BASE_APK_SHA256, "current LAN cannot be the R4 input"
    return previous


def input_apk(args: argparse.Namespace, previous: dict) -> Path:
    candidate = Path(args.input_apk or previous["apk"])
    if not candidate.is_absolute():
        candidate = REPO_ROOT / candidate
    assert sha(candidate) == BASE_APK_SHA256, "pre-R4 APK identity mismatch"
    return candidate


def run(command: list[object], *, env: dict[str, str] | None = None, timeout: int = 600) -> None:
    result = quiet.run([str(part) for part in command], cwd=REPO_ROOT,
                       capture_output=True, timeout=timeout, env=env, check=False)
    if result.returncode:
        output = (result.stdout + result.stderr).decode("utf-8", "replace")
        raise RuntimeError(f"stage failed ({result.returncode}): {output[-3000:]}")


def changed_bodies(name: str, report: dict) -> set[str]:
    if name == "liveness":
        numbers = report["changed_methods"]
    elif name == "refresh":
        numbers = [report["changed_method_body"]]
    else:
        numbers = [row["body"] for row in report["changes"]]
    return {f"boot_ffc6:{number}" for number in numbers}


def new_helpers(name: str, report: dict) -> set[str]:
    if name == "network":
        return set(report["helper_abcs"])
    if name in ("data", "resource"):
        return {report["helper_abc_name"]}
    if name == "ui":
        # The UI report records an AVM2 qualified class name; verification uses
        # the DoABC tag name written by the patcher.
        return {report["helper"].replace("::", ".")}
    return set()


def build(args: argparse.Namespace) -> dict:
    assert not args.work.exists() and not args.output.exists(), "work and output paths must be new"
    assert ".cdn" not in [part.lower() for path in (args.work, args.output) for part in path.resolve().parts]
    previous = previous_lan(args.registry)
    baseline = input_apk(args, previous)
    with zipfile.ZipFile(baseline) as archive:
        assert archive.namelist().count(SWF_MEMBER) == 1
        swf = archive.read(SWF_MEMBER)
    assert hashlib.sha256(swf).hexdigest() == BASE_SWF_SHA256
    args.work.mkdir(parents=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    original = args.work / "baseline.swf"
    original.write_bytes(swf)

    env = os.environ.copy()
    if args.sdk is not None:
        env["STARPOINT_AIR_SDK"] = str(args.sdk)
    if args.java is not None:
        env["STARPOINT_JAVA"] = str(args.java)
    assets = args.work / "resource-assets"
    if args.assets is None:
        run([sys.executable, "-B", PATCH_ROOT / "client-resource-optimization/build_assets.py", assets], env=env)
    else:
        assets.mkdir()
        for name in ("manifest.json", "runtime.swc", "donor.swc"):
            shutil.copyfile(args.assets / name, assets / name)

    current = original
    changed: set[str] = set()
    helpers: set[str] = set()
    stages: list[dict] = []
    for name, script in STAGES:
        output = args.output if name == "ui" else args.work / f"after-{name}.swf"
        command: list[object] = [sys.executable, "-B", PATCH_ROOT / script, current, output]
        if name == "resource":
            command += ["--assets", assets]
        run(command, env=env)
        report = json.loads(output.with_suffix(".json").read_text(encoding="utf-8"))
        assert report["input_swf_sha256"] == sha(current), name
        assert report.get("swf_sha256", report.get("output_swf_sha256")) == sha(output), name
        changed.update(changed_bodies(name, report))
        helpers.update(new_helpers(name, report))
        if name == "data":
            assert report["helper_abc_sha256"] == DATA_HELPER_SHA256
        stages.append({"name": name, "swf_sha256": sha(output),
                       "changed_bodies": sorted(changed_bodies(name, report)),
                       "helpers": sorted(new_helpers(name, report))})
        current = output

    assert len(changed) == 47 and helpers == HELPERS, (len(changed), helpers)
    expected = {"changed_methods": sorted(changed), "helpers": sorted(helpers)}
    pinned = json.loads((HERE / "r4-expected.json").read_text(encoding="utf-8"))
    assert set(changed) == set(pinned["changed_methods"]), "R4 method set mismatch"
    assert helpers == set(pinned["helpers"]), "R4 helper set mismatch"
    expected_path = args.work / "expected.json"
    expected_path.write_text(json.dumps(expected, indent=2) + "\n", encoding="utf-8")
    comparison = verify(original, args.output, expected_path, args.work / "swf-verify",
                        args.java, args.ffdec)
    assert comparison["new_helper_bodies"] == 102
    assert comparison["swf_sha256"] == FINAL_SWF_SHA256
    result = {"status": "reproduced", "input_apk_sha256": BASE_APK_SHA256,
              "input_swf_sha256": BASE_SWF_SHA256, "swf_sha256": FINAL_SWF_SHA256,
              "changed_methods": len(changed), "helpers": len(helpers),
              "helper_bodies": 102, "stages": stages,
              "independent_ffdec_agrees": comparison["independent_ffdec_agrees"]}
    (args.work / "build-result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-apk", type=Path, help="audited pre-R4 LAN APK")
    parser.add_argument("--registry", type=Path, default=PATCH_ROOT / "android-accepted.json")
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--assets", type=Path, help="compiled resource manifest and SWCs; built when omitted")
    parser.add_argument("--sdk", type=Path, help="AIR SDK 51.2.1.5; or set STARPOINT_AIR_SDK")
    parser.add_argument("--java", type=Path, help="Java launcher; or set STARPOINT_JAVA")
    parser.add_argument("--ffdec", type=Path, help="FFDec jar; or set STARPOINT_FFDEC_JAR")
    print(json.dumps(build(parser.parse_args()), indent=2))


if __name__ == "__main__":
    main()
