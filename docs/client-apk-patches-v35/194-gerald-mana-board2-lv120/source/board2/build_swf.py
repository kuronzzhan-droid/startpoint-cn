"""Build patched SWF: python -B -X utf8 build_swf.py [--input <swf> --output <swf>]."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import bootstrap
from bootstrap import INPUT_SWF, OUTPUT_SWF, ROOT, output_path, sha, verify_input
import asm
from framework import Editor
from swfabc import SwfAbc
from audit_support import ALLOWED_TARGETS, audit, require
from pcode_export import export_pcode
import patch


class PatchEditor(Editor):
    """Allow original bodies to change only through reversible insertions."""

    def __init__(self, source, locks):
        super().__init__(source, locks)
        self._applying_insertions = False

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
    files = [
        ROOT / name
        for name in ("bootstrap.py", "patch.py", "build_swf.py", "audit_support.py", "pcode_export.py")
    ]
    hashes = {path.relative_to(ROOT).as_posix(): sha(path.read_bytes()) for path in sorted(files)}
    aggregate = sha(json.dumps(hashes, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    return aggregate, hashes


def build_swf(input_swf: Path | str = INPUT_SWF, output_swf: Path | str = OUTPUT_SWF) -> dict:
    source_digest, source_files = build_sources()
    require(set(patch.TARGETS) == ALLOWED_TARGETS, "patch must declare approved targets")
    source = verify_input(input_swf)
    input_bytes = source.read_bytes()
    input_digest = sha(input_bytes)
    baseline = SwfAbc(source)

    locks = dict(patch.LOCKS)
    editor = PatchEditor(source, locks)
    detail = patch.build(editor)
    editor.apply()

    destination = output_path(output_swf)
    raw = editor.swf.serialize()
    candidate = output_path(destination.parent / f".{destination.name}.candidate.swf")
    try:
        candidate.write_bytes(raw)
        rebuilt = SwfAbc(candidate)
        checks = audit(baseline, rebuilt, editor, patch.TARGETS)
    finally:
        if candidate.exists():
            candidate.unlink()

    require(build_sources() == (source_digest, source_files), "build source changed during construction")
    destination.write_bytes(raw)

    is_default = destination == OUTPUT_SWF.resolve()
    final_labels = set(editor.report)
    pcode_dir = ROOT / "build" / "pcode" if is_default else destination.parent / "pcode"
    exports = export_pcode(rebuilt.abc, final_labels, pcode_dir)

    report = {
        "input": source.as_posix(),
        "input_sha256": input_digest,
        "output": destination.relative_to(ROOT.parent).as_posix(),
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
    if is_default:
        report_path = output_path(ROOT / "build" / "audit.json")
        report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        sums_path = output_path(ROOT / "build" / "SHA256SUMS")
        sums_path.write_text(f"{report['output_sha256']}  {destination.name}\n", encoding="ascii")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default=str(INPUT_SWF), help="Input SWF path")
    parser.add_argument("--output", default=str(OUTPUT_SWF), help="Output SWF path")
    args = parser.parse_args()
    report = build_swf(args.input, args.output)
    print(
        json.dumps(
            {
                "input": report["input"],
                "input_sha256": report["input_sha256"],
                "output": report["output"],
                "output_sha256": report["output_sha256"],
                "audit_pass": True,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    return report


if __name__ == "__main__":
    main()
