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

from patch import (CAPABILITIES, CAPABILITY, GUARD_PREFIX, KEY_PREFIX,
                   STRING_ID_PREFIX, V10_SWF_SHA256, PatchError)
import pcode as splice

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "rank-scene-p2"))
import verify_rank_scene_p2 as independent  # noqa: E402  (path set above)

# Method bodies patched by V9/V10; they must survive this patch untouched. The keys
# are V10-chain body indices; a caller on another chain passes its own mapping.
PRESERVED_BODIES = {52311: "ActionEvaluationResolver/ActionEvaluationResolver",
                    59953: "BallImpl/resolveCollisionForPrimaryOrSummons"}
# Class multinames the new code resolves. Both must already exist in the base pool
# and already be getlex'd from the same ABC: a getlex of a class new to the build
# is a known hard crash.
REQUIRED_CLASSES = ("pinball.master.generated::CustomAbilityStringTable",
                    "pinball.master.generated::SkillReplaceStringTable")
# Container methods the probe calls through the ILogicAssetContainer interface.
# Each must already be in the base pool and already be called from the same ABC.
# getMasterTableMaybe is what makes the V14 all-character probe safe:
# LogicAssetContainer answers it with null instead of ClientError 8013 when the
# table is not in the current scene's asset caches.
REQUIRED_CONTAINER_METHODS = (
    "pinball.asset.logic:ILogicAssetContainer::getMasterTable",
    "pinball.asset.logic:ILogicAssetContainer::getMasterTableMaybe",
)
# The probe must never reach the table through the throwing accessor.
FORBIDDEN_CONTAINER_CALL = "ILogicAssetContainer\"),\"getMasterTable\")"
# Key prefix and guard prefix are the same string once STRING_ID_PREFIX is empty,
# and the assembler interns one pool entry per distinct string -- so V14 adds one.
EXPECTED_NEW_STRINGS = [s.encode() for s in dict.fromkeys((KEY_PREFIX, GUARD_PREFIX))]
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


def _sites(abc, multiname_index, opcodes):
    sites = []
    for index, body in enumerate(abc["bodies"]):
        for instruction in independent.myops.disasm(body["code"]):
            if instruction["name"] in opcodes and instruction["ops"] \
                    and instruction["ops"][0] == multiname_index:
                sites.append(index)
                break
    return sites


def _getlex_sites(abc, multiname_index):
    return _sites(abc, multiname_index, ("getlex",))


def _multiname_index(pools, name):
    return next((i for i in range(1, len(pools["mns"]))
                 if independent._multiname(pools, i) == name), None)


def verify(source: Path, final: Path, *, base_swf_sha256=None, preserved_bodies=None):
    """Prove `final` is `source` plus exactly this patch.

    `base_swf_sha256` lets a chain that does not start from the V10 APK (V13a and
    V14 rebuild from the V8 baseline) pin its own input hash; `preserved_bodies`
    carries that chain's indices for the V9/V10 methods that must not move.
    """
    expected_base = base_swf_sha256 or V10_SWF_SHA256
    preserved = PRESERVED_BODIES if preserved_bodies is None else preserved_bodies
    check(hashlib.sha256(source.read_bytes()).hexdigest() == expected_base,
          "unknown base SWF input")
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
    # present and already getlex'd in the untouched base build.
    class_multiname = {}
    for name in REQUIRED_CLASSES:
        index = _multiname_index(pa, name)
        check(index is not None, f"{name} is not in the base constant pool")
        sites = _getlex_sites(a, index)
        check(len(sites) >= 2, f"{name} has no existing getlex precedent in the base ABC")
        class_multiname[name] = {"multiname": index, "existing_getlex_bodies": sites}

    # Same rule for the interface methods the probe calls: already in the pool and
    # already called from this ABC, so the patch introduces no new dispatch shape.
    container_multiname = {}
    for name in REQUIRED_CONTAINER_METHODS:
        index = _multiname_index(pa, name)
        check(index is not None, f"{name} is not in the base constant pool")
        sites = _sites(a, index, ("callproperty", "callpropvoid", "callproplex"))
        check(sites, f"{name} has no existing call precedent in the base ABC")
        container_multiname[name] = {"multiname": index,
                                     "existing_call_bodies": len(sites),
                                     "first_call_body": sites[0]}
    # The all-character probe may only touch the master table through the
    # non-throwing accessor; the throwing one must not appear in the splice at all.
    spliced = "\n".join(s for t in splice.TARGETS for s in t.code)
    check("getMasterTableMaybe" in spliced,
          "the probe must reach the master table through getMasterTableMaybe")
    check(spliced.count(FORBIDDEN_CONTAINER_CALL)
          == spliced.count("SkillReplaceStringTable"),
          "getMasterTable is only allowed for the SkillReplaceStringTable pass")

    check(len(a["bodies"]) == len(b["bodies"]), "method body count changed")
    changed = [i for i, (x, y) in enumerate(zip(a["bodies"], b["bodies"])) if x != y]
    expected = sorted(t.body_index for t in splice.TARGETS)
    check(changed == expected, "changed method bodies are not exactly the four targets: %s" % changed)
    for index, label in preserved.items():
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
            "capabilities": list(CAPABILITIES),
            "string_id_prefix": STRING_ID_PREFIX,
            "guard_prefix": GUARD_PREFIX,
            "base_swf_sha256": expected_base,
            "final_swf": str(final), "swf_sha256": hashlib.sha256(final.read_bytes()).hexdigest(),
            "swf_bytes": final.stat().st_size, "changed_tags": changed_tags,
            "changed_method_bodies": changed,
            "total_main_abc_method_bodies": len(a["bodies"]),
            "added_pool_strings": [s.decode() for s in added_strings],
            "added_multinames": 0, "added_instance_traits": 0,
            "getlex_precedent": class_multiname,
            "container_call_precedent": container_multiname,
            "preserved_v9_v10_bodies": {str(k): v for k, v in preserved.items()},
            "proof": proof}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("final", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--chain", choices=("v10", "v8"), default="v10",
                        help="v10: the V11 chain (base = the V10 APK's SWF); "
                             "v8: the V13a/V14 chain (base = step2-v10.swf)")
    args = parser.parse_args()
    from patch import V8_CHAIN_PRESERVED_BODIES, V8_CHAIN_V10_SWF_SHA256
    report = verify(args.source, args.final,
                    base_swf_sha256=(V8_CHAIN_V10_SWF_SHA256 if args.chain == "v8" else None),
                    preserved_bodies=(V8_CHAIN_PRESERVED_BODIES if args.chain == "v8" else None))
    text = json.dumps(report, indent=2) + "\n"
    args.report.write_text(text, encoding="utf-8", newline="\n")
    print(text)
