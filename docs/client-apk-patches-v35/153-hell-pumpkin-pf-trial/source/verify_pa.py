"""独立读回两份 P-a 产物；验证结构、执行语义、变异检出和双产物一致性。"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True
from pa_common import (
    BODY_INDEX, HEADER, INPUT_LOCKS, ROOT, SwfAbc, asm, body_bytes,
    emit_json, load_locked, local_path, sha, write_json,
)
from pa_integrity import compare
from pa_pair import verify_peer
from pa_semantics import run_mutations, verify_semantics


def verify_one(source_name, target_name):
    before = load_locked("input/" + source_name)
    target = local_path(ROOT / "out" / target_name)
    after = SwfAbc(target)
    old, new = before.abc.bodies[BODY_INDEX], after.abc.bodies[BODY_INDEX]
    structural = compare(before, after)
    assert new[1:5] == old[1:5] == HEADER
    assert old[5][:0xA0] == new[5][:0xA0]
    assert old[5][0xAA:] == new[5][0xAA:0xF6]
    assert len(new[5]) == 318
    old_ins, new_ins = asm.decode(old[5]), asm.decode(new[5])
    assert [(i.name, i.args) for i in new_ins if i.name == "getlex"] == [
        (i.name, i.args) for i in old_ins if i.name == "getlex"]
    checksum = sha(target.read_bytes())
    assert local_path(target.with_suffix(".swf.sha256")).read_text(encoding="ascii").strip() == (
        f"{checksum}  {target.name}")
    semantic = verify_semantics(before.abc, old, after.abc, new)
    mutations = run_mutations(before.abc, old, after.abc, new)
    expected, pair_report = verify_peer(before)
    assert body_bytes(new) == expected
    return body_bytes(new), {
        "input": source_name, "output": target_name,
        "input_sha256": sha(before.path.read_bytes()), "output_sha256": checksum,
        "structural": structural, "semantics": semantic, "mutations": mutations,
        "input_pair": pair_report,
        "protected_instruction_ranges_byte_identical": True,
    }


def main():
    if not __debug__:
        raise SystemExit("禁止 -O：离线验证必须启用全部断言")
    records, reports = [], []
    for source in INPUT_LOCKS:
        record, report = verify_one(source, source.removesuffix(".swf") + "-pa.swf")
        records.append(record)
        reports.append(report)
    assert records[0] == records[1], "两份新方法体不逐字节一致"
    report = {
        "status": "全部离线检查通过",
        "patched_body_records_byte_identical": True,
        "patched_body_record_sha256": sha(records[0]), "outputs": reports,
        "runtime_verification": "未核实；按要求未运行 AIR、adb、模拟器或 APK",
    }
    write_json(ROOT / "out" / "verification.json", report)
    emit_json(report)


if __name__ == "__main__":
    main()
