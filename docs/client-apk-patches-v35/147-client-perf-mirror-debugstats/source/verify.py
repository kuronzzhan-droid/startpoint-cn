"""第十四轮总验收：结构保持（只改 5 个方法 + 尾增）、逐插入逆恢复、同源重放、双版一致、
真实字节码差分（被改方法与被改片段）、变异必须全部变红、变异后完整基线复跑一致。写 verify-report.json。"""
import copy
import json

import bootstrap
from bootstrap import ROOT, INPUTS, sha
import asm
import bodies
from common import freeze
from integrity import compare, restore_inserted_body, unchanged_scaffolding
from swfabc import SwfAbc
from static_check import check_body, negative_controls
from framework import Editor
import build
import perf15_patch as perf_patch
from tests import perf15_tests as perf_tests


def sources():
    files = [p for p in ROOT.rglob("*.py")
             if not {"work", "__pycache__", "apk-patches-additions"} & set(p.relative_to(ROOT).parts)]
    files += [ROOT / "baseline-locks.json", ROOT / "release-locks.json"]
    return {p.relative_to(ROOT).as_posix(): sha(p.read_bytes()) for p in sorted(files)}


def lock_negatives():
    rejected = []
    for label, lock in build.locks().items():
        for part in ("sha", "header"):
            broken = copy.deepcopy(build.locks())
            broken[label][part] = "0" * 64 if part == "sha" else [lock["header"][0] + 1, *lock["header"][1:]]
            editor = Editor(INPUTS["test"][0], broken)
            try:
                editor.replace(label, editor.body(label)[5])
            except asm.AsmError:
                rejected.append(f"{label}:{part}")
            else:
                raise AssertionError("锁被绕过 " + label + part)
    return rejected


def main():
    if not __debug__:
        raise ValueError("禁止 -O")
    bootstrap.check_baseline()
    before_sources = sources()
    release = build.release_locks()
    targets = list(build.locks())
    report = {"task": "run15 client-perf-mirror-stats-v1", "profiles": {}}
    records = []
    for profile, (path, expected, output) in INPUTS.items():
        before, after = SwfAbc(path), SwfAbc(ROOT / output)
        assert sha(after.path.read_bytes()) == release[profile]["sha256"]
        rec = compare(before, after, targets)
        rec["restoration"] = unchanged_scaffolding(before, after, targets)
        raw, editor, _ = build.construct(path, perf_patch.GROUPS)
        assert raw == after.path.read_bytes(), "同源重放字节不同"
        assert build.method_record(editor) == release[profile]["methods"]
        rec["insertion_restoration"] = {
            label: restore_inserted_body(before.abc.bodies[bodies.resolve(before.abc, label)],
                                         after.abc.bodies[bodies.resolve(after.abc, label)],
                                         detail["insertions"])
            for label, detail in editor.report.items()}
        records.append({label: freeze(after.abc.bodies[bodies.resolve(after.abc, label)])
                        for label in release[profile]["methods"]})
        initial = perf_tests.run(before.abc, after.abc)
        mutations = perf_tests.mutations(before.abc, after.abc)
        survived = [k for k, v in mutations.items() if v["status"] == "SURVIVED"]
        assert not survived, "变异存活: " + ", ".join(survived)
        final = perf_tests.run(before.abc, after.abc)
        assert final == initial, "变异后完整基线与初始不一致"
        rec.update(input_sha256=expected, output_sha256=sha(raw), replay_byte_identical=True,
                   business=initial, mutations=mutations, baseline_after_mutations="pass")
        report["profiles"][profile] = rec
        print(json.dumps({"profile": profile, "structure": "pass", "business": "pass",
                          "mutations_killed": len(mutations)}), flush=True)
    assert records[0] == records[1], "两版被改/追加方法记录不同"
    report["two_profiles_method_records_identical"] = True
    report["lock_negative_controls"] = lock_negatives()
    report["static_negative_controls"] = negative_controls()
    assert sources() == before_sources, "验收期间源码变化"
    report["sources"] = before_sources
    report["status"] = "pass"
    report["scope"] = ("离线：AVM2 字节码结构/静态检查、真实字节码差分解释、变异复审。"
                       "AIR 验证器与真机行为另见 README 设备记录。")
    build.json_write(ROOT / "verify-report.json", report)
    print(json.dumps({"status": "pass", "lock_negatives": len(report["lock_negative_controls"])}))


if __name__ == "__main__":
    main()
