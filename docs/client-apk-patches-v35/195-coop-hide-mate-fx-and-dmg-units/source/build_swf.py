"""Build the coop teammate effect suppression SWF: python -B -X utf8 build_swf.py [--input <swf>] [--output <swf>]."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import struct
import types

import bootstrap
from bootstrap import (
    DEFAULT_INPUT,
    DEFAULT_OUTPUT,
    ROOT,
    output_path,
    sha,
    verify_default_input,
)
import asm
from framework import Editor
from swfabc import SwfAbc
from audit_support import ALLOWED_TARGETS, audit, require
from pcode_export import export_pcode_pair
from matefx import patch


class PatchEditor(Editor):
    """Allow original bodies to change only through reversible instruction insertions (no new methods/slots)."""

    def __init__(self, source, locks):
        super().__init__(source, locks)
        self._applying_insertions = False
        self.pool._base_double_count = len(self.abc.doubles)
        self.pool.added_doubles = []
        orig_report = self.pool.report

        def _pool_double(pool_self, value: float) -> int:
            value = float(value)
            packed = struct.pack("<d", value)
            for index, item in enumerate(pool_self.abc.doubles):
                if index and struct.pack("<d", item) == packed:
                    return index
            index = len(pool_self.abc.doubles)
            pool_self.abc.doubles.append(value)
            pool_self.added_doubles.append(value)
            return index

        def _pool_report(pool_self) -> dict:
            rep = orig_report()
            rep["added_doubles"] = list(pool_self.added_doubles)
            rep["base_double_count"] = pool_self._base_double_count
            return rep

        self.pool.double = types.MethodType(_pool_double, self.pool)
        self.pool.report = types.MethodType(_pool_report, self.pool)

    def add_method(self, *args, **kwargs):
        raise asm.AsmError("new methods are forbidden by task specification")

    def add_slot(self, *args, **kwargs):
        raise asm.AsmError("new slots/traits are forbidden by task specification")

    def insert(self, label, at, code, incoming=asm.FORBID):
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
        for name in ("bootstrap.py", "build_swf.py", "audit_support.py", "pcode_export.py")
    ]
    for directory in ("matefx", "vendor-ref"):
        files.extend((ROOT / directory).rglob("*.py"))
    hashes = {
        path.relative_to(ROOT).as_posix(): sha(path.read_bytes())
        for path in sorted(files)
    }
    aggregate = sha(json.dumps(hashes, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    return aggregate, hashes


def build_one(source_path: Path | str, destination_path: Path | str) -> dict:
    source_digest, source_files = build_sources()
    require(set(patch.TARGETS) == ALLOWED_TARGETS, "patch must declare precisely the 13 matefx targets")

    source = Path(source_path).resolve()
    if source == DEFAULT_INPUT.resolve():
        verify_default_input()
    require(source.exists(), f"input SWF does not exist: {source}")

    destination = output_path(destination_path)
    require(destination != source, "output path must differ from input path")

    baseline = SwfAbc(source)
    locks = patch.lock_for_abc(baseline.abc)
    editor = PatchEditor(source, locks)
    detail = patch.build(editor)
    editor.apply()

    raw = editor.swf.serialize()
    candidate = output_path(ROOT / "build" / ".candidate.swf")
    try:
        candidate.write_bytes(raw)
        rebuilt = SwfAbc(candidate)
        checks = audit(baseline, rebuilt, editor, patch.TARGETS)
    finally:
        if candidate.exists():
            candidate.unlink()

    exports = export_pcode_pair(baseline.abc, rebuilt.abc, patch.TARGETS, ROOT / "build" / "pcode")
    require(build_sources() == (source_digest, source_files), "build source changed during construction")
    destination.write_bytes(raw)

    input_rel = source.relative_to(ROOT).as_posix() if source.is_relative_to(ROOT) else str(source)
    output_rel = destination.relative_to(ROOT).as_posix()
    report = {
        "input": input_rel,
        "input_sha256": sha(source.read_bytes()),
        "output": output_rel,
        "output_sha256": sha(raw),
        "output_bytes": len(raw),
        "build_source_sha256": source_digest,
        "build_source_files": source_files,
        "baseline_method_locks": locks,
        "changed_methods": editor.report,
        "new_methods": editor.new_methods,
        "pool_additions": editor.pool.report(),
        "structural_audit": checks,
        "pcode_exports": exports,
        "patch_detail": detail,
        "device_validation": "not performed",
    }
    report_path = output_path(ROOT / "build" / "audit-wt-1008092.json")
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    sums = [f"{sha(destination.read_bytes())}  {destination.name}"]
    output_path(ROOT / "build" / "SHA256SUMS").write_text("\n".join(sums) + "\n", encoding="ascii")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default=str(DEFAULT_INPUT), help="Input SWF path")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output SWF path")
    args = parser.parse_args()

    report = build_one(args.input, args.output)
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
