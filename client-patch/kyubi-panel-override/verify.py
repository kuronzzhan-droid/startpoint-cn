#!/usr/bin/env python3
"""Independent ABC/branch/stack proof for the four-method panel-override patch.

Everything is re-derived with the rank-scene-p2 parser, which shares no code with
FFDec or with pcode.py: the SWF tag set, the constant pools, the ABC structure
tables, every method body, the symbolic listing of the inserted instructions and a
forward abstract interpretation of stack and scope depth over every path.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

from patch import CAPABILITY, GUARD_PREFIX, KEY_PREFIX, V10_SWF_SHA256, PatchError
import pcode as splice

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "rank-scene-p2"))
import verify_rank_scene_p2 as independent  # noqa: E402  (path set above)

# Method bodies patched by V9/V10; they must survive V11 untouched.
PRESERVED_BODIES = {52311: "ActionEvaluationResolver/ActionEvaluationResolver",
                    59953: "BallImpl/resolveCollisionForPrimaryOrSummons"}
# Class multinames the new code resolves. Both must already exist in the V10 pool
# and already be getlex'd from the same ABC: a getlex of a class new to the build
# is a known hard crash.
REQUIRED_CLASSES = ("pinball.master.generated::CustomAbilityStringTable",
                    "pinball.master.generated::SkillReplaceStringTable")
EXPECTED_NEW_STRINGS = [KEY_PREFIX.encode(), GUARD_PREFIX.encode()]
INSERT_AT = 2  # every patched body opens with getlocal0 / pushscope


def check(condition, message):
    if not condition:
        raise PatchError(message)


# --------------------------------------------------------------------------
# P-code text -> the symbolic listing the independent disassembler must produce.
_QNAME = re.compile(r'QName\((?:Package)?Namespace\("([^"]*)"\),"([^"]+)"\)')
_MULTINAME_L = re.compile(r'MultinameL\(\[PackageNamespace\("","(\d+)"\)\]\)')
_STRING = re.compile(r'^(pushstring) "(.*)"$')


def _render_multinames(statement: str) -> str:
    statement = _MULTINAME_L.sub(lambda m: "L{nsset#%s}" % m.group(1), statement)
    return _QNAME.sub(lambda m: "%s::%s" % (m.group(1), m.group(2)), statement)


def expected_listing(code: list[str]) -> list[str]:
    """Translate pcode.py's statements into independent._normalize output."""
    position = {}
    index = INSERT_AT
    for statement in code:
        if statement.endswith(":"):
            position[statement[:-1]] = index
        else:
            index += 1
    listing = []
    for statement in code:
        if statement.endswith(":"):
            continue
        match = _STRING.match(statement)
        if match:
            text = match.group(2).replace("\\n", "\n").replace("\\\\", "\\")
            listing.append('pushstring "%s"' % text)
            continue
        name = statement.split(" ", 1)[0]
        if name in ("jump", "iftrue", "iffalse", "ifeq", "ifne", "iflt", "ifle",
                    "ifgt", "ifge", "ifstricteq", "ifstrictne"):
            listing.append("%s #%d" % (name, position[statement.split(" ", 1)[1]]))
            continue
        listing.append(_render_multinames(statement))
    return listing


# --------------------------------------------------------------------------
def prove_insertion(before, after, at, count):
    ops = independent.myops
    old, new = ops.disasm(before["code"]), ops.disasm(after["code"])
    check(len(new) - len(old) == count, "unexpected instruction count delta")
    old_index = {row["addr"]: n for n, row in enumerate(old)}
    new_index = {row["addr"]: n for n, row in enumerate(new)}

    def original_index(address):
        index = new_index[address]
        check(not at <= index < at + count, "an original branch was redirected into new code")
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
    check(not stack["errors"], "stack or branch-boundary verification failed: %s" % stack["errors"])
    check(stack["max_stack_computed"] <= stack["max_stack_declared"], "maxstack is too small")
    check(stack["max_scope_computed"] <= stack["max_scope_declared"], "maxscope is too small")
    check(stack["unreachable"] == 0, "unreachable instructions were introduced")
    return stack


def _getlex_sites(abc, multiname_index):
    sites = []
    for index, body in enumerate(abc["bodies"]):
        for instruction in independent.myops.disasm(body["code"]):
            if instruction["name"] == "getlex" and instruction["ops"][0] == multiname_index:
                sites.append(index)
                break
    return sites


def verify(source: Path, final: Path):
    check(hashlib.sha256(source.read_bytes()).hexdigest() == V10_SWF_SHA256, "unknown V10 input")
    sa, va, ta = independent._tags_of(source)
    sb, vb, tb = independent._tags_of(final)
    check((sa, va, len(ta)) == (sb, vb, len(tb)), "SWF signature/version/tag count changed")
    changed_tags = [i for i, (a, b) in enumerate(zip(ta, tb)) if a != b]
    check(changed_tags == [347], "a non-target SWF tag changed: %s" % changed_tags)
    na, raw_a = independent._main_abc(ta)
    nb, raw_b = independent._main_abc(tb)
    check(na == nb == "boot_ffc6", "unexpected ABC name")
    a, b = independent.myabc.parse_abc(raw_a), independent.myabc.parse_abc(raw_b)

    for field in ("methods", "metadata", "classes", "scripts", "instances"):
        check(a[field] == b[field], f"unrelated {field} structure changed")
    pa, pb = a["pools"], b["pools"]
    for field in pa:
        check(pa[field] == pb[field][: len(pa[field])], f"original {field} pool changed")
        if field != "strs":
            check(pa[field] == pb[field], f"unexpected {field} pool additions")
    added_strings = pb["strs"][len(pa["strs"]):]
    check(added_strings == EXPECTED_NEW_STRINGS,
          "unexpected string pool additions: %r" % (added_strings,))
    # The line split must reuse the V10 newline literal, which also proves the
    # assembler read "\n" as an escape rather than as two characters.
    check(b"\n" in pa["strs"], "the V10 pool has no newline literal to reuse")
    newline_index = pa["strs"].index(b"\n")

    # The one construct with a crash precedent: prove both classes were already
    # present and already getlex'd in the untouched V10 build.
    class_multiname = {}
    for name in REQUIRED_CLASSES:
        index = next((i for i in range(1, len(pa["mns"]))
                      if independent._multiname(pa, i) == name), None)
        check(index is not None, f"{name} is not in the V10 constant pool")
        sites = _getlex_sites(a, index)
        check(len(sites) >= 2, f"{name} has no existing getlex precedent in the V10 ABC")
        class_multiname[name] = {"multiname": index, "existing_getlex_bodies": sites}

    check(len(a["bodies"]) == len(b["bodies"]), "method body count changed")
    changed = [i for i, (x, y) in enumerate(zip(a["bodies"], b["bodies"])) if x != y]
    expected = sorted(t.body_index for t in splice.TARGETS)
    check(changed == expected, "changed method bodies are not exactly the four targets: %s" % changed)
    for index, label in PRESERVED_BODIES.items():
        check(a["bodies"][index]["code"] == b["bodies"][index]["code"],
              f"V9/V10 patched method {label} changed")

    proof = {}
    for target in splice.TARGETS:
        before, after = a["bodies"][target.body_index], b["bodies"][target.body_index]
        for field in ("method", "initscope", "maxscope", "ex", "traits"):
            check(before[field] == after[field],
                  f"{target.cls}.{target.method}: body field {field} changed")
        check((before["maxstack"], before["localcount"]) == target.old_header,
              f"{target.cls}.{target.method}: unexpected V10 body header")
        check((after["maxstack"], after["localcount"]) == target.new_header,
              f"{target.cls}.{target.method}: unexpected patched body header")
        pushed = {i["ops"][0] for i in independent.myops.disasm(after["code"])
                  if i["name"] == "pushstring"}
        check(newline_index in pushed,
              f"{target.cls}.{target.method}: the line split does not reuse the V10 newline literal")
        listing = expected_listing(target.code)
        after["pools"] = pb
        stack = prove_insertion(before, after, INSERT_AT, len(listing))
        del after["pools"]
        actual = independent._normalize(after, pb)[INSERT_AT:INSERT_AT + len(listing)]
        check(actual == listing,
              "%s.%s: inserted sequence is not exact\n  want %r\n  got  %r"
              % (target.cls, target.method,
                 [x for x, y in zip(listing, actual) if x != y][:3],
                 [y for x, y in zip(listing, actual) if x != y][:3]))
        proof[target.body_index] = {
            "method": f"pinball.common.data.ability:{target.cls}/{target.method}",
            "inserted_instructions": len(listing),
            "before_code_bytes": len(before["code"]), "after_code_bytes": len(after["code"]),
            "header": {"maxstack": after["maxstack"], "localcount": after["localcount"]},
            "all_original_instructions_and_branches_preserved": True,
            "stack": stack,
        }
    return {"status": "verified", "capability": CAPABILITY,
            "base_swf_sha256": V10_SWF_SHA256,
            "final_swf": str(final), "swf_sha256": hashlib.sha256(final.read_bytes()).hexdigest(),
            "swf_bytes": final.stat().st_size, "changed_tags": changed_tags,
            "changed_method_bodies": changed,
            "total_main_abc_method_bodies": len(a["bodies"]),
            "added_pool_strings": [s.decode() for s in added_strings],
            "added_multinames": 0, "added_instance_traits": 0,
            "getlex_precedent": class_multiname,
            "preserved_v9_v10_bodies": {str(k): v for k, v in PRESERVED_BODIES.items()},
            "proof": proof}


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
