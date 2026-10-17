"""Test round5-r1 preservation and path preflight using workspace-only fakes."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile
from unittest.mock import patch

import release_history as history

WORKSPACE = Path(__file__).resolve().parents[1]
VARIANTS = {variant: {"output": f"v34-{variant}-unsigned-aligned.apk"}
            for variant in ("x86", "arm64")}
HISTORY = Path("previous-build/round5-o8-o12-r1-versionCode1008002")
DIAGNOSTIC = Path("diagnostics/v34-without-O9.swf")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write(root, name, data):
    path = (root / name).resolve()
    assert path.is_relative_to(WORKSPACE.resolve())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def prepare(root):
    files = {"v34.swf": b"fake round5 r1 SWF; no executable payload",
             "README.md": b"fake round5 r1 notes", str(DIAGNOSTIC): b"fake r1 diagnostic"}
    files.update({spec["output"]: f"fake round5 r1 {variant} APK".encode()
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
    history.ROOT, history.VARIANTS, history.ROUND5_SHA = root, VARIANTS, report["swf"]["sha256"]
    return files, report


def check_saved(root, files):
    for name in ("build-report.json", "README.md", "v34.swf"):
        assert (root / HISTORY / name).read_bytes() == files[name], name
    for spec in VARIANTS.values():
        assert (root / HISTORY / spec["output"]).read_bytes() == files[spec["output"]]
    assert (root / HISTORY / DIAGNOSTIC).read_bytes() == files[str(DIAGNOSTIC)]


def exercise_recovery(root, state):
    files, _report = prepare(root)
    history.ensure_round5_input()
    if state in ("metadata_only", "one_apk_already_moved"):
        for name in ("build-report.json", "README.md"):
            write(root, HISTORY / name, files[name])
    if state == "one_apk_already_moved":
        name = VARIANTS["x86"]["output"]
        write(root, HISTORY / "v34.swf", files["v34.swf"])
        (root / name).replace(root / HISTORY / name)
    if state == "complete_then_new_root":
        history.preserve_round5()
        for name in files:
            write(root, name, ("fake newer r2 root " + name).encode())
        before = {name: (root / name).read_bytes() for name in files}
        history.ensure_round5_input()
        history.preserve_round5()
        assert before == {name: (root / name).read_bytes() for name in files}
    else:
        history.preserve_round5()
        assert all(not (root / spec["output"]).exists() for spec in VARIANTS.values())
        assert not (root / DIAGNOSTIC).exists()
        history.preserve_round5()
    check_saved(root, files)
    assert (root / "inputs/v34-o8-o12-r1-verified.swf").read_bytes() == files["v34.swf"]
    return {"state": state, "passed": True, "fixture_root": str(root.relative_to(WORKSPACE)),
            "saved_old_outputs_verified": True, "input_r1_swf_retained": True,
            "newer_root_untouched": True if state == "complete_then_new_root" else None}


def exercise_rejection(root, kind):
    files, report = prepare(root)
    outside = root.parent / (root.name + "-outside.txt")
    write(root.parent, outside.name, b"fake outside mocked ROOT, still inside real workspace")
    original_outside = outside.read_bytes()
    if kind == "diagnostic_source_escape":
        report["o9_policy"]["diagnostic_output"] = str(outside)
        report["o9_policy"]["diagnostic_expected_sha256"] = digest(original_outside)
        write(root, "build-report.json", json.dumps(report).encode())
    before = {path.relative_to(root).as_posix(): path.read_bytes()
              for path in root.rglob("*") if path.is_file()}
    with patch.object(history.os, "replace", side_effect=AssertionError("move before path preflight")) as move:
        try:
            if kind == "relative_target_escape":
                history.preserve_verified_delivery("../escaped-delivery", history.ROUND5_SHA)
            else:
                history.preserve_round5()
        except AssertionError:
            rejected = True
        else:
            rejected = False
        assert rejected and move.call_count == 0, (kind, rejected, move.call_count)
    after = {path.relative_to(root).as_posix(): path.read_bytes()
             for path in root.rglob("*") if path.is_file()}
    assert before == after, (kind, "files changed before rejection")
    assert outside.read_bytes() == original_outside
    return {"state": kind, "passed": True, "rejected_before_any_replace": True,
            "fixture_files_untouched": True, "outside_mocked_root_file_untouched": True}


def main():
    work = WORKSPACE / "work/history-recovery-r2-fixtures"
    work.mkdir(parents=True, exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix="run-", dir=work)).resolve()
    assert root.is_relative_to(WORKSPACE.resolve())
    saved = history.ROOT, history.VARIANTS, history.ROUND5_SHA
    try:
        cases = []
        for state in ("initial", "metadata_only", "one_apk_already_moved", "complete_then_new_root"):
            case_root = root / state
            case_root.mkdir()
            cases.append(exercise_recovery(case_root, state))
        for kind in ("relative_target_escape", "diagnostic_source_escape"):
            case_root = root / kind
            case_root.mkdir()
            cases.append(exercise_rejection(case_root, kind))
    finally:
        history.ROOT, history.VARIANTS, history.ROUND5_SHA = saved
    result = {"passed": True, "case_count": len(cases), "cases": cases,
              "release_history_sha256": digest((WORKSPACE / "scripts/release_history.py").read_bytes()),
              "test_source_sha256": digest(Path(__file__).read_bytes()),
              "scope": "Only synthetic text under workspace work/; no real release file moved"}
    output = WORKSPACE / "verification/round6-history-recovery.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
