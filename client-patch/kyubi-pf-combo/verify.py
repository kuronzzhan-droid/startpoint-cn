#!/usr/bin/env python3
"""Independent ABC/branch/stack proof for the two-method Kyubi snapshot patch."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys
import zlib

from patch import PRIVATE_PF, V9_SWF_SHA256, PatchError

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "rank-scene-p2"))
import verify_rank_scene_p2 as independent

TARGETS = {52311: 117, 59953: 144}  # Original instruction index immediately after the assignment.


def check(condition, message):
    if not condition:
        raise PatchError(message)


def tags_of(path):
    raw = path.read_bytes()
    signature, version = raw[:3], raw[3]
    check(signature in (b"FWS", b"CWS"), "unsupported SWF compression")
    body = zlib.decompress(raw[8:]) if signature == b"CWS" else raw[8:]
    check(struct.unpack_from("<I", raw, 4)[0] == len(body) + 8, "invalid SWF declared length")
    return signature, version, independent.extract_tags.tags(body)


def prove_insertion(before, after, at):
    ops = independent.myops
    old, new = ops.disasm(before["code"]), ops.disasm(after["code"])
    count = len(new) - len(old)
    check(count > 0, "target method has no insertion")
    old_index = {row["addr"]: n for n, row in enumerate(old)}
    new_index = {row["addr"]: n for n, row in enumerate(new)}

    def original_index(address):
        index = new_index[address]
        check(not at <= index < at + count, "original branch was redirected into new code")
        return index if index < at else index - count

    for i, original in enumerate(old):
        actual = new[i if i < at else i + count]
        check(original["name"] == actual["name"], "an original opcode changed")
        old_targets, new_targets = ops.targets(original), ops.targets(actual)
        if old_targets:
            check([old_index[x] for x in old_targets] == [original_index(x) for x in new_targets],
                  "an original branch target changed")
        else:
            check(original["ops"] == actual["ops"], "an original instruction operand changed")
    stack = independent._abstract_interpret(after, after["pools"])
    check(not stack["errors"], "stack or branch-boundary verification failed")
    check(stack["max_stack_computed"] <= stack["max_stack_declared"], "maxstack is too small")
    check(stack["max_scope_computed"] <= stack["max_scope_declared"], "maxscope is too small")
    return {"inserted_instructions": count, "all_original_instructions_and_branches_preserved": True,
            "stack": stack}


def verify(source: Path, final: Path):
    check(hashlib.sha256(source.read_bytes()).hexdigest() == V9_SWF_SHA256, "unknown V9 input")
    sa, va, ta = tags_of(source)
    sb, vb, tb = tags_of(final)
    check((sa, va, len(ta)) == (sb, vb, len(tb)), "SWF signature/version/tag count changed")
    changed_tags = [i for i, (a, b) in enumerate(zip(ta, tb)) if a != b]
    check(changed_tags == [347], "a non-target SWF tag changed")
    na, raw_a = independent._main_abc(ta)
    nb, raw_b = independent._main_abc(tb)
    check(na == nb == "boot_ffc6", "unexpected ABC name")
    a, b = independent.myabc.parse_abc(raw_a), independent.myabc.parse_abc(raw_b)
    for field in ("methods", "metadata", "classes", "scripts"):
        check(a[field] == b[field], f"unrelated {field} structure changed")
    pa, pb = a["pools"], b["pools"]
    for field in pa:
        check(pa[field] == pb[field][:len(pa[field])], f"original {field} pool changed")
        if field not in ("strs", "mns"):
            check(pa[field] == pb[field], f"unexpected {field} pool additions")
    check(pb["strs"][len(pa["strs"]):] == [b"kyubiPowerFlipInitialCombo", PRIVATE_PF.encode()],
          "unexpected strings added")
    check(pb["mns"][len(pa["mns"]):] == [(7, 1, len(pa["strs"]))], "unexpected QName added")
    check(len(a["instances"]) == len(b["instances"]), "instance count changed")
    changed_instances = [i for i, (x, y) in enumerate(zip(a["instances"], b["instances"])) if x != y]
    check(changed_instances == [6108], "non-Ball instance traits changed")
    old_instance, new_instance = a["instances"][6108], b["instances"][6108]
    check(old_instance[:-1] == new_instance[:-1] and old_instance[-1] == new_instance[-1][:-1],
          "existing Ball slot order or constructor changed")
    check(new_instance[-1][-1] == (len(pa["mns"]), 0, (0, 38, 0, 0), ()),
          "new slot must be one public default-zero int")
    check(len(a["bodies"]) == len(b["bodies"]), "method body count changed")
    changed = [i for i, (x, y) in enumerate(zip(a["bodies"], b["bodies"])) if x != y]
    check(changed == sorted(TARGETS), "non-target method body changed")
    proof = {}
    for index, position in TARGETS.items():
        before, after = a["bodies"][index], b["bodies"][index]
        check({k: v for k, v in before.items() if k != "code"} ==
              {k: v for k, v in after.items() if k != "code"}, "target method metadata changed")
        after["pools"] = pb
        proof[index] = prove_insertion(before, after, position)
        del after["pools"]
    # Symbolic listing is a separate readback of the assembled instructions.
    resolver = independent._normalize(b["bodies"][52311], pb)[117:150]
    ball = independent._normalize(b["bodies"][59953], pb)[144:150]
    check(ball == ["getlocal0", "getlex pinball.common.mask::MaskGeneral", "getproperty ::maskBit",
                   "getlocal 6", "bitxor", "setproperty ::kyubiPowerFlipInitialCombo"],
          "Ball snapshot was not decoded from the consumed combo")
    expected_resolver = ["getlocal 5", "getproperty ::kind", "getproperty ::index", "pushbyte 5",
        "ifne #150", "getlocal 5", "getproperty ::kind", "getproperty ::params", "pushbyte 0",
        "getproperty L{nsset#1}", f'pushstring "{PRIVATE_PF}"', "ifne #150", "getlocal 5",
        "getproperty ::type", "getproperty ::index", "pushbyte 2", "ifne #150", "getlocal 5",
        "getproperty ::type", "getproperty ::params", "pushbyte 0", "getproperty L{nsset#1}",
        "istype pinball.scene.battle.battle.squad.ball::BallImpl", "iffalse #150", "getlocal0",
        "getlocal 5", "getproperty ::type", "getproperty ::params", "pushbyte 0",
        "getproperty L{nsset#1}", "astype pinball.scene.battle.battle.squad.ball::BallImpl",
        "getproperty ::kyubiPowerFlipInitialCombo", "setproperty ::initialCombo"]
    check(resolver == expected_resolver, "resolver inserted branch sequence is not exact")
    return {"status": "verified", "capability": "kyubi-pf-initial-combo-v1",
            "final_swf": str(final), "swf_sha256": hashlib.sha256(final.read_bytes()).hexdigest(),
            "swf_bytes": final.stat().st_size, "changed_tags": changed_tags,
            "changed_method_bodies": changed, "total_main_abc_method_bodies": len(a["bodies"]),
            "added_slot_default": 0, "proof": proof}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("final", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    report = verify(args.source, args.final)
    text = json.dumps(report, indent=2) + "\n"
    args.report.write_text(text, encoding="utf-8", newline="\n")
    print(text)
