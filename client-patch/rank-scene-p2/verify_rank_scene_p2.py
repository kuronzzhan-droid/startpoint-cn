#!/usr/bin/env python3
"""Independent structural verification of the P2 rank-scene patch.

Deliberately does NOT reuse the reader the builder uses.  The builder drives
FFDec and re-reads with `client-patch/dual-form-v1/abc_methods.py`; this module
parses the SWF and the ABC again with the vendored `independent/` toolkit
(`extract_tags.py` / `myabc.py` / `myops.py`), so a bug in one reader cannot
vouch for itself.

What it proves, in order of how much it matters for surgery C:

1.  **Nothing else moved.**  Exactly one SWF tag differs (the big `boot_ffc6`
    DoABC2); every constant pool except `strings` is element-for-element equal;
    `strings` is a strict prefix extension by exactly the expected count;
    method_info / metadata / instance_info / class_info / script_info are equal;
    every method body except the expected ones is byte-identical.

2.  **The edit is exactly the intended edit.**  Each changed body is decoded to a
    *normalized* instruction listing in which every branch operand is replaced by
    the **index of the target instruction** (not a byte offset) and every
    multiname / string operand by its resolved text.  The baseline and patched
    listings are then diffed: the edit script must equal the expected one.
    This is what catches a hijacked jump — if the insertion had re-routed an
    existing branch, that branch's normalized target index would change and show
    up as an extra edit.

3.  **The lookupswitch really has six live arms.**  The switch instruction is
    decoded from the patched bytes: default plus six case targets, each landing
    on an instruction boundary; cases 0..4 must point at the same normalized
    blocks as in the baseline, and case 5 at the new block, whose mnemonic
    sequence is checked against the expected seven instructions.

4.  **The verifier accepts the code.**  A forward abstract interpreter walks
    every reachable path of each changed body tracking operand-stack depth and
    scope depth (runtime multinames included), and asserts: no underflow, no
    stack-depth merge conflict, every branch target on an instruction boundary,
    computed max stack <= declared `maxstack`, computed max scope <= declared
    `maxscopedepth`.  Those are the conditions AVM2's own verifier checks before
    it will run a method, and the only way to fail them is a VerifyError on the
    device.
"""

from __future__ import annotations

import difflib
import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
INDEP = HERE / "independent"


class VerifyError(RuntimeError):
    pass


def _load(name: str):
    spec = importlib.util.spec_from_file_location("p2_" + name, INDEP / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules["p2_" + name] = module
    spec.loader.exec_module(module)
    return module


extract_tags = _load("extract_tags")
myabc = _load("myabc")
myops = _load("myops")

if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
import check_title_ui_string_key  # noqa: E402  (path set above)

# Runtime multinames consume extra operands off the stack.
MN_OPS = ("getsuper", "setsuper", "getproperty", "setproperty", "initproperty",
          "deleteproperty", "getdescendants", "findpropstrict", "findproperty",
          "callproperty", "callpropvoid", "callproplex", "callsuper", "callsupervoid",
          "constructprop", "getlex")

MN_OPERAND_OPS = set(MN_OPS) | {"astype", "coerce", "istype", "newcatch", "dxns"}
STRING_OPERAND_OPS = {"pushstring", "dxns"}


def _rt_extra(mns, index: int) -> int:
    if index == 0 or index >= len(mns) or mns[index] is None:
        return 0
    kind = mns[index][0]
    if kind in (0x0F, 0x10):        # RTQName: namespace off the stack
        return 1
    if kind in (0x11, 0x12):        # RTQNameL: namespace + name off the stack
        return 2
    if kind in (0x1B, 0x1C):        # MultinameL: name off the stack
        return 1
    return 0


def _effect(instruction, mns):
    pop, push = myops.effect(instruction)
    if instruction["name"] in MN_OPS:
        pop += _rt_extra(mns, instruction["ops"][0])
    return pop, push


def _string(pools, index: int) -> str:
    if index == 0 or index >= len(pools["strs"]):
        return "<str#%d>" % index
    return pools["strs"][index].decode("utf-8", "replace")


def _multiname(pools, index: int) -> str:
    mns = pools["mns"]
    if index == 0 or index >= len(mns) or mns[index] is None:
        return "*"
    entry = mns[index]
    kind = entry[0]
    if kind in (0x07, 0x0D):                       # QName / QNameA: (ns, name)
        namespace = pools["nss"][entry[1]]
        return "%s::%s" % (_string(pools, namespace[1]), _string(pools, entry[2]))
    if kind in (0x09, 0x0E):                       # Multiname / A: (name, ns_set)
        return "%s{nsset#%d}" % (_string(pools, entry[1]), entry[2])
    if kind in (0x0F, 0x10):                       # RTQName / A
        return "RT::%s" % _string(pools, entry[1])
    if kind in (0x1B, 0x1C):                       # MultinameL / A
        return "L{nsset#%d}" % entry[1]
    return "<mn kind 0x%02x>" % kind


def _normalize(body, pools) -> list[str]:
    """Instruction listing with branch operands resolved to target indices."""
    instructions = myops.disasm(body["code"])
    addr2index = {ins["addr"]: n for n, ins in enumerate(instructions)}
    end_index = len(instructions)

    def target(address: int) -> str:
        if address in addr2index:
            return "#%d" % addr2index[address]
        if address == len(body["code"]):
            return "#end"
        return "!!off-boundary(%d)" % address

    listing = []
    for instruction in instructions:
        name = instruction["name"]
        ops = instruction["ops"]
        if name == "lookupswitch":
            base = instruction["addr"]
            rendered = "lookupswitch default=%s cases=[%s]" % (
                target(base + ops[0]),
                ",".join(target(base + case) for case in ops[2]),
            )
        elif myops.targets(instruction):
            rendered = "%s %s" % (name, target(myops.targets(instruction)[0]))
        elif name in STRING_OPERAND_OPS:
            rendered = '%s "%s"' % (name, _string(pools, ops[0]))
        elif name in MN_OPERAND_OPS:
            rest = "".join(", %s" % value for value in ops[1:])
            rendered = "%s %s%s" % (name, _multiname(pools, ops[0]), rest)
        else:
            rendered = "%s%s" % (name, (" " + ", ".join(str(v) for v in ops)) if ops else "")
        listing.append(rendered)
    return listing


def _abstract_interpret(body, pools) -> dict:
    """Forward abstract interpretation of stack and scope depth over every path."""
    instructions = myops.disasm(body["code"])
    addr2index = {ins["addr"]: n for n, ins in enumerate(instructions)}
    count = len(instructions)
    stack_at: list[int | None] = [None] * count
    scope_at: list[int | None] = [None] * count
    stack_at[0] = 0
    scope_at[0] = body["initscope"]
    work = [0]
    max_stack = 0
    max_scope = body["initscope"]
    errors: list[str] = []

    while work:
        index = work.pop()
        depth = stack_at[index]
        scope = scope_at[index]
        instruction = instructions[index]
        pop, push = _effect(instruction, pools["mns"])
        if depth - pop < 0:
            errors.append("UNDERFLOW #%d %s (have %d, pops %d)"
                          % (index, instruction["name"], depth, pop))
            continue
        after = depth - pop + push
        name = instruction["name"]
        next_scope = scope + (1 if name in ("pushscope", "pushwith")
                              else -1 if name == "popscope" else 0)
        max_stack = max(max_stack, depth, after)
        max_scope = max(max_scope, next_scope)

        successors = []
        for address in myops.targets(instruction):
            if address not in addr2index:
                errors.append("BRANCH #%d %s -> byte %d is NOT an instruction start"
                              % (index, name, address))
            else:
                successors.append(addr2index[address])
        if myops.falls_through(instruction) and index + 1 < count:
            successors.append(index + 1)

        for successor in successors:
            if stack_at[successor] is None:
                stack_at[successor] = after
                scope_at[successor] = next_scope
                work.append(successor)
            elif stack_at[successor] != after:
                errors.append("MERGE CONFLICT at #%d (%s): %d vs %d"
                              % (successor, instructions[successor]["name"],
                                 stack_at[successor], after))

    return {
        "instructions": count,
        "max_stack_computed": max_stack,
        "max_stack_declared": body["maxstack"],
        "max_scope_computed": max_scope,
        "max_scope_declared": body["maxscope"],
        "unreachable": sum(1 for value in stack_at if value is None),
        "errors": errors,
    }


def _tags_of(path: Path):
    signature, version, declared, payload = extract_tags.read_swf(str(path))
    return signature, version, extract_tags.tags(payload)


def _main_abc(tags):
    best = None
    for code, payload in tags:
        if code == 82 and len(payload) > 1_000_000:
            if best is not None:
                raise VerifyError("more than one large DoABC2 tag")
            nul = payload.index(b"\x00", 4)
            best = (payload[4:nul].decode(), payload[nul + 1:])
    if best is None:
        raise VerifyError("main DoABC2 not found")
    return best


def verify(
    base_swf: Path,
    patched_swf: Path,
    *,
    expected_bodies: dict[int, list[tuple[str, ...]]],
    expected_new_strings: list[str],
    switch_body: int,
    switch_case_count: int,
    new_block_mnemonics: list[str],
) -> dict:
    """Run every P2 check.

    :param base_swf: the P1 SWF this patch was built on.
    :param patched_swf: the P2 SWF FFDec produced.
    :param expected_bodies: body index -> the exact difflib edit script expected,
        as a list of ``(tag, baseline_lines..., patched_lines...)`` descriptors
        built by the caller (see :func:`edit_script`).
    :param expected_new_strings: strings the patch is allowed to append to the pool.
    :param switch_body: body index whose lookupswitch grew.
    :param switch_case_count: how many case arms the switch must have afterwards.
    :param new_block_mnemonics: mnemonics of the new basic block, in order.
    :returns: a JSON-serialisable report.
    :raises VerifyError: on the first violated invariant.
    """
    report: dict = {}

    signature_a, version_a, tags_a = _tags_of(base_swf)
    signature_b, version_b, tags_b = _tags_of(patched_swf)
    if (signature_a, version_a) != (signature_b, version_b):
        raise VerifyError("SWF signature/version drifted")
    if len(tags_a) != len(tags_b):
        raise VerifyError("tag count %d -> %d" % (len(tags_a), len(tags_b)))
    differing = [i for i, (a, b) in enumerate(zip(tags_a, tags_b)) if a != b]
    if len(differing) != 1:
        raise VerifyError("expected exactly one differing tag, got %r" % (differing,))
    report["tags"] = {"total": len(tags_a), "differing": differing}

    name_a, abc_a = _main_abc(tags_a)
    name_b, abc_b = _main_abc(tags_b)
    if name_a != name_b:
        raise VerifyError("DoABC2 name drifted %s -> %s" % (name_a, name_b))
    if differing[0] != [i for i, (c, _) in enumerate(tags_a) if c == 82 and len(_) > 1_000_000][0]:
        raise VerifyError("the differing tag is not the main DoABC2")
    report["doabc2"] = {"name": name_a, "abc_len": [len(abc_a), len(abc_b)]}

    A = myabc.parse_abc(abc_a)
    B = myabc.parse_abc(abc_b)

    pools_a, pools_b = A["pools"], B["pools"]
    for field in ("ints", "uints", "dbls", "nss", "nsets", "mns"):
        if pools_a[field] != pools_b[field]:
            raise VerifyError("constant pool '%s' changed" % field)
    strings_a, strings_b = pools_a["strs"], pools_b["strs"]
    if strings_b[: len(strings_a)] != strings_a:
        raise VerifyError("the string pool is not a prefix extension; entries were rewritten")
    appended = [s.decode("utf-8", "replace") for s in strings_b[len(strings_a):]]
    if appended != expected_new_strings:
        raise VerifyError("string pool appended %r, expected %r" % (appended, expected_new_strings))
    report["pools"] = {
        "identical": ["ints", "uints", "doubles", "namespaces", "ns_sets", "multinames"],
        "strings_baseline": len(strings_a),
        "strings_patched": len(strings_b),
        "strings_appended": appended,
    }

    for field in ("methods", "metadata", "instances", "classes", "scripts"):
        if A[field] != B[field]:
            raise VerifyError("%s table changed" % field)
    report["tables_identical"] = ["method_info", "metadata", "instance_info",
                                  "class_info", "script_info"]

    bodies_a, bodies_b = A["bodies"], B["bodies"]
    if len(bodies_a) != len(bodies_b):
        raise VerifyError("method_body count changed")
    changed = [i for i, (a, b) in enumerate(zip(bodies_a, bodies_b)) if a != b]
    if sorted(changed) != sorted(expected_bodies):
        raise VerifyError("changed bodies %r, expected %r" % (changed, sorted(expected_bodies)))
    report["changed_bodies"] = changed
    report["total_bodies"] = len(bodies_a)

    body_reports = []
    for index in sorted(expected_bodies):
        a, b = bodies_a[index], bodies_b[index]
        for field in ("method", "maxstack", "localcount", "initscope", "maxscope", "ex", "traits"):
            if a[field] != b[field]:
                raise VerifyError("body %d: %s drifted %r -> %r" % (index, field, a[field], b[field]))

        listing_a = _normalize(a, pools_a)
        listing_b = _normalize(b, pools_b)
        for listing, tag in ((listing_a, "baseline"), (listing_b, "patched")):
            bad = [line for line in listing if "!!off-boundary" in line]
            if bad:
                raise VerifyError("body %d (%s): branch off instruction boundary: %r"
                                  % (index, tag, bad))

        script = [
            (tag, listing_a[i1:i2], listing_b[j1:j2])
            for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(
                a=listing_a, b=listing_b, autojunk=False).get_opcodes()
            if tag != "equal"
        ]
        if script != expected_bodies[index]:
            raise VerifyError("body %d: edit script is\n%r\nexpected\n%r"
                              % (index, script, expected_bodies[index]))

        interp_a = _abstract_interpret(a, pools_a)
        interp_b = _abstract_interpret(b, pools_b)
        for interp, tag in ((interp_a, "baseline"), (interp_b, "patched")):
            if interp["errors"]:
                raise VerifyError("body %d (%s): %r" % (index, tag, interp["errors"]))
            if interp["max_stack_computed"] > interp["max_stack_declared"]:
                raise VerifyError("body %d (%s): stack overflow %d > %d"
                                  % (index, tag, interp["max_stack_computed"],
                                     interp["max_stack_declared"]))
            if interp["max_scope_computed"] > interp["max_scope_declared"]:
                raise VerifyError("body %d (%s): scope overflow %d > %d"
                                  % (index, tag, interp["max_scope_computed"],
                                     interp["max_scope_declared"]))
        body_reports.append({
            "body_index": index,
            "code_len": [len(a["code"]), len(b["code"])],
            "baseline": interp_a,
            "patched": interp_b,
            "edit_script": [(tag, before, after) for tag, before, after in script],
        })
    report["bodies"] = body_reports

    # ---- the lookupswitch, decoded straight from the patched bytes -------------
    switch_report = _check_switch(bodies_a[switch_body], bodies_b[switch_body],
                                  pools_a, pools_b, switch_case_count, new_block_mnemonics)
    report["lookupswitch"] = switch_report

    # ---- the page-title key must resolve in the CN ui_string master table ------
    # Not a cosmetic concern: MasterBinaryMap.getIndex deletes the master file
    # and throws ClientError 8601 on a missing key.  See
    # check_title_ui_string_key.py for the disassembly this is based on.
    report["title_ui_string_key"] = check_title_ui_string_key.assert_title_keys_shippable(
        verbose=False)
    return report


def _check_switch(base_body, patched_body, pools_a, pools_b,
                  case_count: int, new_block_mnemonics: list[str]) -> dict:
    base_ins = myops.disasm(base_body["code"])
    patched_ins = myops.disasm(patched_body["code"])

    def switches(instructions):
        return [(n, i) for n, i in enumerate(instructions) if i["name"] == "lookupswitch"]

    base_switches = switches(base_ins)
    patched_switches = switches(patched_ins)
    if len(base_switches) != len(patched_switches):
        raise VerifyError("lookupswitch count %d -> %d"
                          % (len(base_switches), len(patched_switches)))

    # This method has more than one switch (the outer button-id one and an inner
    # RushEventTimeKind one).  Exactly one of them may have grown; every other
    # switch must be untouched, arm for arm.
    grew = [k for k, ((_, a), (_, b)) in enumerate(zip(base_switches, patched_switches))
            if len(a["ops"][2]) != len(b["ops"][2])]
    if grew != [0]:
        raise VerifyError("expected only the first lookupswitch to grow, got %r" % (grew,))
    base_n, base_switch = base_switches[0]
    patched_n, patched_switch = patched_switches[0]
    untouched = []
    for k in range(1, len(base_switches)):
        _, a = base_switches[k]
        _, b = patched_switches[k]
        if a["ops"][0] != b["ops"][0] or a["ops"][2] != b["ops"][2]:
            raise VerifyError("lookupswitch #%d (not the one we edited) changed arms" % k)
        untouched.append({"index": patched_switches[k][0], "cases": len(b["ops"][2])})

    base_cases = base_switch["ops"][2]
    patched_cases = patched_switch["ops"][2]
    if len(patched_cases) != case_count:
        raise VerifyError("lookupswitch has %d cases, expected %d"
                          % (len(patched_cases), case_count))
    if len(patched_cases) != len(base_cases) + 1:
        raise VerifyError("lookupswitch case count did not grow by exactly one")
    if patched_switch["ops"][1] != case_count - 1:
        raise VerifyError("lookupswitch case_count field is %d, must be len-1 = %d"
                          % (patched_switch["ops"][1], case_count - 1))

    base_addr2n = {i["addr"]: n for n, i in enumerate(base_ins)}
    patched_addr2n = {i["addr"]: n for n, i in enumerate(patched_ins)}

    def resolve(instructions, addr2n, switch, offset):
        address = switch["addr"] + offset
        if address not in addr2n:
            raise VerifyError("lookupswitch arm -> byte %d is not an instruction start" % address)
        return addr2n[address]

    def block_of(instructions, start: int) -> list[str]:
        """Mnemonics from *start* until the block terminates."""
        out = []
        index = start
        while index < len(instructions):
            name = instructions[index]["name"]
            out.append(name)
            if name in ("jump", "returnvoid", "returnvalue", "throw", "lookupswitch"):
                break
            index += 1
        return out

    base_arms = [resolve(base_ins, base_addr2n, base_switch, off) for off in base_cases]
    patched_arms = [resolve(patched_ins, patched_addr2n, patched_switch, off)
                    for off in patched_cases]
    base_default = resolve(base_ins, base_addr2n, base_switch, base_switch["ops"][0])
    patched_default = resolve(patched_ins, patched_addr2n, patched_switch,
                              patched_switch["ops"][0])

    # cases 0..n-1 must still open the same blocks as before
    for case in range(len(base_arms)):
        before = block_of(base_ins, base_arms[case])
        after = block_of(patched_ins, patched_arms[case])
        if before != after:
            raise VerifyError("case %d block changed: %r -> %r" % (case, before, after))
    if block_of(base_ins, base_default) != block_of(patched_ins, patched_default):
        raise VerifyError("the default arm changed")

    new_block = block_of(patched_ins, patched_arms[-1])
    if new_block != new_block_mnemonics:
        raise VerifyError("the new case block is %r, expected %r"
                          % (new_block, new_block_mnemonics))

    # the new arm must be the last thing in the method: nothing falls into it
    predecessors = []
    for n, instruction in enumerate(patched_ins):
        if n + 1 == patched_arms[-1] and myops.falls_through(instruction):
            predecessors.append(("fallthrough", n, instruction["name"]))
        for address in myops.targets(instruction):
            if patched_addr2n.get(address) == patched_arms[-1] and n != patched_n:
                predecessors.append(("branch", n, instruction["name"]))
    if predecessors:
        raise VerifyError("the new block is reachable from something other than the "
                          "switch: %r" % (predecessors,))

    return {
        "switch_instruction_index": patched_n,
        "case_count_field": patched_switch["ops"][1],
        "default_target_index": patched_default,
        "case_target_indices": patched_arms,
        "new_block": new_block,
        "new_block_only_reachable_from_switch": True,
        "other_switches_unchanged": untouched,
    }
