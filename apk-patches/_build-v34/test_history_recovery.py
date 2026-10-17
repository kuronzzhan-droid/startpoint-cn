"""Exercise round4 archive recovery with fake files only under workspace work/."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile

import release_history as history

WORKSPACE = Path(__file__).resolve().parents[1]
VARIANTS = {variant: {"output": f"v34-{variant}-unsigned-aligned.apk"}
            for variant in ("x86", "arm64")}
HISTORY = Path("previous-build/round4-o8-o11-versionCode1008002")
DIAGNOSTIC = Path("diagnostics/v34-without-O9.swf")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write(root, name, data):
    path = (root / name).resolve()
    assert path.is_relative_to(WORKSPACE.resolve())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def prepare(root):
    files = {"v34.swf": b"fake round4 SWF; no executable payload",
             "README.md": b"fake round4 notes", str(DIAGNOSTIC): b"fake old diagnostic"}
    files.update({spec["output"]: f"fake round4 {variant} APK".encode()
                  for variant, spec in VARIANTS.items()})
    report = {"swf": {"sha256": digest(files["v34.swf"])},
              "variants": {variant: {"output": {"sha256": digest(files[spec["output"]])}}
                           for variant, spec in VARIANTS.items()},
              "o9_policy": {"diagnostic_output": str(DIAGNOSTIC),
                            "diagnostic_expected_sha256": digest(files[str(DIAGNOSTIC)])}}
    files["build-report.json"] = json.dumps(report).encode()
    for name, data in files.items():
        write(root, name, data)
    (root / "inputs").mkdir()
    return files, report


def check_saved(root, files):
    for name in ("build-report.json", "README.md", "v34.swf"):
        assert (root / HISTORY / name).read_bytes() == files[name], name
    for spec in VARIANTS.values():
        assert (root / HISTORY / spec["output"]).read_bytes() == files[spec["output"]]
    assert (root / HISTORY / DIAGNOSTIC).read_bytes() == files[str(DIAGNOSTIC)]


def exercise(root, state):
    files, report = prepare(root)
    history.ROOT, history.VARIANTS, history.ROUND4_SHA = root, VARIANTS, report["swf"]["sha256"]
    history.ensure_round4_input()
    if state in ("metadata_only", "one_apk_already_moved"):
        for name in ("build-report.json", "README.md"):
            write(root, HISTORY / name, files[name])
    if state == "one_apk_already_moved":
        name = VARIANTS["x86"]["output"]
        write(root, HISTORY / "v34.swf", files["v34.swf"])
        (root / name).replace(root / HISTORY / name)
    if state == "complete_then_new_root":
        history.preserve_round4()
        for name in files:
            write(root, name, ("fake newer root " + name).encode())
        before = {name: (root / name).read_bytes() for name in files}
        history.ensure_round4_input()
        history.preserve_round4()
        assert before == {name: (root / name).read_bytes() for name in files}
    else:
        history.preserve_round4()
        assert all(not (root / spec["output"]).exists() for spec in VARIANTS.values())
        assert not (root / DIAGNOSTIC).exists()
        history.preserve_round4()
    check_saved(root, files)
    assert (root / "inputs/v34-o8-o11-verified.swf").read_bytes() == files["v34.swf"]
    return {"state": state, "passed": True, "fixture_root": str(root.relative_to(WORKSPACE)),
            "old_report_swf_and_two_apks_verified": True, "old_diagnostic_verified": True,
            "input_swf_retained": True,
            "newer_root_untouched": True if state == "complete_then_new_root" else None}


def main():
    work = WORKSPACE / "work/history-recovery-fixtures"
    work.mkdir(parents=True, exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix="run-", dir=work)).resolve()
    assert root.is_relative_to(WORKSPACE.resolve())
    saved = history.ROOT, history.VARIANTS, history.ROUND4_SHA
    try:
        cases = []
        for state in ("initial", "metadata_only", "one_apk_already_moved", "complete_then_new_root"):
            case_root = root / state
            case_root.mkdir()
            cases.append(exercise(case_root, state))
    finally:
        history.ROOT, history.VARIANTS, history.ROUND4_SHA = saved
    result = {"passed": True, "case_count": len(cases), "cases": cases,
              "release_history_sha256": digest((WORKSPACE / "scripts/release_history.py").read_bytes()),
              "test_source_sha256": digest(Path(__file__).read_bytes()),
              "scope": "Only synthetic text payloads under workspace work/; no real APK or release file moved"}
    output = WORKSPACE / "verification/round5-history-recovery.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
