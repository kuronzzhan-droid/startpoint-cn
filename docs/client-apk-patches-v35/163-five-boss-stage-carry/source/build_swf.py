"""Rebuild both immutable p13 profiles: python build_swf.py."""
from __future__ import annotations

import argparse
import json

import bootstrap
from bootstrap import ROOT, INPUTS, build_path, output_path, sha, verify_input
import asm
import bodies
from framework import Editor
from swfabc import SwfAbc
from audit_support import ALLOWED_TARGETS, audit, require
from pcode_export import export_pcode


class PatchEditor(Editor):
    """Allow original bodies to change only through reversible insertions."""

    def __init__(self, source, locks):
        super().__init__(source, locks)
        self._applying_insertions = False

    def number(self, value):
        try:
            return super().number(value)
        except asm.AsmError:
            return ("pushint", self.pool.integer(value))

    def insert(self, label, at, code, incoming=asm.ENTER):
        require(label in self.locks, f"undeclared insertion target: {label}")
        return super().insert(label, at, code, incoming)

    def replace(self, *args, **kwargs):
        require(self._applying_insertions, "direct body replacement is forbidden; use insert")
        return super().replace(*args, **kwargs)

    def apply(self):
        self._applying_insertions = True
        try:
            return super().apply()
        finally:
            self._applying_insertions = False


def build_sources():
    files = [ROOT / name for name in ("bootstrap.py", "build_swf.py", "audit_support.py", "pcode_export.py")]
    for directory in ("stage_carry", "vendor"):
        files.extend((ROOT / directory).rglob("*.py"))
    hashes = {path.relative_to(ROOT).as_posix(): sha(path.read_bytes()) for path in sorted(files)}
    aggregate = sha(json.dumps(hashes, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    return aggregate, hashes


def build_one(profile, patch):
    source_digest, source_files = build_sources()
    require(set(patch.TARGETS) == ALLOWED_TARGETS, "patch must declare precisely the two continuation targets")
    source = verify_input(profile)
    baseline = SwfAbc(source)
    locks = {}
    for label in patch.TARGETS:
        body = baseline.abc.bodies[bodies.resolve(baseline.abc, label)]
        locks[label] = {"sha": sha(body[5]), "header": body[1:5]}
    editor = PatchEditor(source, locks)
    detail = patch.build(editor)
    editor.apply()
    destination = output_path(build_path(profile))
    raw = editor.swf.serialize()
    candidate = output_path(ROOT / "build" / f".{profile}.candidate.swf")
    try:
        candidate.write_bytes(raw)
        rebuilt = SwfAbc(candidate)
        checks = audit(baseline, rebuilt, editor, patch.TARGETS)
    finally:
        if candidate.exists():
            candidate.unlink()
    final_labels = set(editor.report) | {entry["label"] for entry in editor.new_methods}
    exports = export_pcode(rebuilt.abc, final_labels, ROOT / "build" / "pcode" / profile)
    require(build_sources() == (source_digest, source_files), "build source changed during construction")
    destination.write_bytes(raw)
    report = {
        "profile": profile,
        "input": source.relative_to(ROOT).as_posix(),
        "input_sha256": INPUTS[profile][1],
        "output": destination.relative_to(ROOT).as_posix(),
        "output_sha256": sha(raw),
        "output_bytes": len(raw),
        "build_source_sha256": source_digest,
        "build_source_files": source_files,
        "baseline_method_locks": locks,
        "changed_methods": editor.report,
        "new_methods": editor.new_methods,
        "pool_additions": editor.pool.report(),
        "structural_audit": checks,
        "final_pcode": exports,
        "patch_detail": detail,
        "device_validation": "not performed",
    }
    report_path = output_path(ROOT / "build" / f"audit-{profile}.json")
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=["all", *INPUTS], default="all")
    args = parser.parse_args()
    from stage_carry import patch

    profiles = list(INPUTS) if args.profile == "all" else [args.profile]
    reports = []
    for profile in profiles:
        report = build_one(profile, patch)
        reports.append(report)
        print(json.dumps({"profile": profile, "output": report["output"],
                          "sha256": report["output_sha256"], "audit_pass": True}, ensure_ascii=False), flush=True)
    sums = []
    for profile in INPUTS:
        path = build_path(profile)
        if path.exists():
            sums.append(f"{sha(path.read_bytes())}  {path.name}")
    output_path(ROOT / "build" / "SHA256SUMS").write_text("\n".join(sums) + "\n", encoding="ascii")
    return reports


if __name__ == "__main__":
    main()
