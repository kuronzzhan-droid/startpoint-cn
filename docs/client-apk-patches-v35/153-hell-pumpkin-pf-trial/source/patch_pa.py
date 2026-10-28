"""可重放的 P-a 单方法指令补丁；只读写本目录，不联网。"""
from __future__ import annotations

import argparse
import difflib
import os
import sys
import tempfile

sys.dont_write_bytecode = True
from pa_common import (
    BODY_INDEX, ROOT, SwfAbc, body_bytes, emit_json, listing,
    load_locked, local_path, sha, write_json,
)
from pa_integrity import compare
from pa_pair import verify_peer
from pa_patch import build
from pa_semantics import run_mutations, verify_semantics


def patch_file(input_path, output_path):
    source, target = local_path(input_path), local_path(output_path)
    assert target.suffix.lower() == ".swf", "输出扩展名必须为 .swf"
    assert not target.is_relative_to(ROOT / "input"), "不能修改 input 目录"
    assert not any(target.is_relative_to(ROOT / name) for name in ("vendor", "ref"))
    assert source != target, "不能覆盖输入 SWF"
    before = load_locked(source)
    expected_record, peer_report = verify_peer(before)
    working = load_locked(source)
    _, patch_report = build(working)
    assert body_bytes(working.abc.bodies[BODY_INDEX]) == expected_record
    raw = working.serialize()
    del working
    if target.exists():
        assert target.read_bytes() == raw, "输出已存在且内容不同，拒绝覆盖"
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, temp_name = tempfile.mkstemp(prefix=".pa-", suffix=".swf", dir=target.parent)
    temporary = local_path(temp_name)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(raw)
        after = SwfAbc(temporary)
        integrity = compare(before, after)
        assert body_bytes(after.abc.bodies[BODY_INDEX]) == expected_record
        semantics = verify_semantics(before.abc, before.abc.bodies[BODY_INDEX],
                                     after.abc, after.abc.bodies[BODY_INDEX])
        mutations = run_mutations(before.abc, before.abc.bodies[BODY_INDEX],
                                  after.abc, after.abc.bodies[BODY_INDEX])
        # 全部验证通过后才替换目标产物；所有文件均在已检查的工作目录内。
        temporary.replace(target)
    finally:
        if temporary.exists():
            temporary.unlink()
    checksum = sha(raw)
    local_path(target.with_suffix(target.suffix + ".sha256")).write_text(
        f"{checksum}  {target.name}\n", encoding="ascii")
    before_text = listing(before.abc, before.abc.bodies[BODY_INDEX])
    after_text = listing(after.abc, after.abc.bodies[BODY_INDEX])
    diff = (
        "仅追加 strings[94182] = 'mod_hp_'；无新增 multiname/int/trait/class。\n"
        "原 [0x0000,0x00a0)、[0x00aa,0x00f6) 全部逐字节保持。\n"
        "替换原 case 0 拒绝块 10 字节；gate 追加至 0x00f6；命中回跳真实 label 0x00a9。\n\n"
        + "".join(difflib.unified_diff(
            before_text.splitlines(True), after_text.splitlines(True),
            fromfile="matchTrial.before", tofile="matchTrial.after")))
    for name, text in (("before.pcode", before_text), ("after.pcode", after_text),
                       ("diff", diff)):
        path = local_path(target.parent / ("matchTrial." + name + ".txt"))
        if path.exists():
            assert path.read_text(encoding="utf-8") == text, "双产物 P-code 不一致"
        path.write_text(text, encoding="utf-8")
    report = {
        "status": "全部离线检查通过", "input": str(source.relative_to(ROOT)),
        "output": str(target.relative_to(ROOT)), "input_sha256": sha(source.read_bytes()),
        "output_sha256": checksum, "patch": patch_report, "integrity": integrity,
        "input_pair": peer_report, "semantics": semantics, "mutations": mutations,
    }
    write_json(target.with_suffix(".report.json"), report)
    return report


def main():
    if not __debug__:
        raise SystemExit("禁止 -O：本工具必须启用全部断言")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    emit_json(patch_file(args.input, args.output))


if __name__ == "__main__":
    main()
