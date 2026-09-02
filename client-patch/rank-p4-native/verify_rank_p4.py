#!/usr/bin/env python3
"""Independent structural verification of the P4 native-list client patch.

"Independent" means: this file never looks at the P-code text the patcher wrote.
It decodes both SWFs from bytes with the standalone `myabc`/`myops` readers that
were written for P2, and re-derives every claim from the decoded ABC.

What it proves, in order of how much it would hurt to get wrong:

1. Exactly one SWF tag differs, and it is the main DoABC2.
2. The int / uint / double / namespace / ns-set / **multiname** pools are
   byte-identical, and the string pool is a prefix extension whose appended
   entries are exactly the declared set.  A patch that resolved a name it was
   not supposed to would show up here.
3. method_info / metadata / instance_info / class_info / script_info are
   byte-identical - no trait, class or method was added anywhere.
4. Exactly the declared method bodies changed.
5. In every changed body, the baseline instruction listing survives **verbatim**:
   every difflib hunk is either a declared `replace` (whose removed lines are
   spelled out here by hand) or a pure `insert`.  Nothing of the original code
   was rewritten, re-routed or dropped.
6. Forward abstract interpretation of both versions: no stack underflow, no
   stack-depth merge conflict at any join, no branch landing off an instruction
   boundary, and the computed stack/scope depths fit the declared headers.
7. maxstack / localcount only move to their declared new values.

Note on honesty: the *mnemonic sequence* of an inserted block is compared
against a list the builder derives from the patch module, so that one check is
not independent - it catches an assembler mishap, not a design mistake.  Every
other check above is derived from the bytes alone.
"""

from __future__ import annotations

import difflib
import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
P2 = HERE.parents[0] / "rank-scene-p2"


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


sys.path.insert(0, str(P2 / "independent"))
p2verify = _load(P2 / "verify_rank_scene_p2.py", "p4_p2verify")
myabc = _load(P2 / "independent" / "myabc.py", "p4_myabc")
myops = _load(P2 / "independent" / "myops.py", "p4_myops")


class VerifyError(RuntimeError):
    pass


def _mnemonics(listing: list[str]) -> list[str]:
    return [line.split(" ", 1)[0] for line in listing]


def _strip_targets(listing: list[str]) -> list[str]:
    """Blank out branch operands so a prologue insert does not renumber the world.

    `_normalize` renders branch operands as instruction indices, which every
    instruction downstream of an insertion shifts by.  Diffing the *stripped*
    listings isolates the real edit; :func:`_check_branch_targets` then proves,
    separately and exactly, that no surviving branch changed where it lands.
    """
    stripped = []
    for line in listing:
        name = line.split(" ", 1)[0]
        if name == "lookupswitch":
            stripped.append("lookupswitch <targets>")
        elif line.startswith(("jump ", "iftrue ", "iffalse ", "ifeq ", "ifne ", "iflt ",
                              "ifle ", "ifgt ", "ifge ", "ifnlt ", "ifnle ", "ifngt ",
                              "ifnge ", "ifstricteq ", "ifstrictne ")):
            stripped.append(name + " <target>")
        else:
            stripped.append(line)
    return stripped


def _targets_by_index(body) -> list[list]:
    """Per instruction, the indices its branches land on (`"end"` past the tail)."""
    instructions = myops.disasm(body["code"])
    addr2index = {ins["addr"]: n for n, ins in enumerate(instructions)}
    end = len(body["code"])
    out = []
    for instruction in instructions:
        row = []
        for address in myops.targets(instruction):
            if address == end:
                row.append("end")
            elif address in addr2index:
                row.append(addr2index[address])
            else:
                row.append("off-boundary(%d)" % address)
        out.append(row)
    return out


def _check_branch_targets(name: str, body_a, body_b, opcodes) -> int:
    """Every branch that survived the patch must still land on the same instruction.

    The alignment comes from the diff's `equal` runs: baseline instruction *i*
    corresponds to patched instruction *j*.  A jump whose destination moved -
    the classic way a hand-written prologue silently hijacks control flow -
    fails here even though both listings still "look" the same.
    """
    align = {}
    for tag, i1, i2, j1, j2 in opcodes:
        if tag == "equal":
            for offset in range(i2 - i1):
                align[i1 + offset] = j1 + offset
    targets_a = _targets_by_index(body_a)
    targets_b = _targets_by_index(body_b)
    checked = 0
    for i, j in align.items():
        row_a, row_b = targets_a[i], targets_b[j]
        if len(row_a) != len(row_b):
            raise VerifyError("%s: instruction #%d changed branch count %d -> %d"
                              % (name, i, len(row_a), len(row_b)))
        for target_a, target_b in zip(row_a, row_b):
            want = "end" if target_a == "end" else align.get(target_a)
            if want is None:
                raise VerifyError("%s: instruction #%d targets #%r, which the patch removed"
                                  % (name, i, target_a))
            if target_b != want:
                raise VerifyError("%s: instruction #%d was re-routed: #%r -> #%r (expected #%r)"
                                  % (name, i, target_a, target_b, want))
            checked += 1
    return checked


def verify(
    base_swf: Path,
    patched_swf: Path,
    *,
    expected_bodies: dict,
    expected_new_strings: list[str],
) -> dict:
    """Check *patched_swf* against *base_swf*.

    :param base_swf: the P2 SWF this patch was built on.
    :param patched_swf: what FFDec produced.
    :param expected_bodies: body index -> dict with keys
        ``name``, ``hunks`` (list of ``("replace", [removed...], n_added)`` or
        ``("insert", [], n_added)``), ``inserted_mnemonics`` (list of lists, one
        per insert hunk, in order), ``maxstack`` and ``localcount``
        (``None`` = must not change).
    :param expected_new_strings: the strings the patch may append to the pool.
    :returns: a JSON-serialisable report.
    :raises VerifyError: on the first violated invariant.
    """
    report: dict = {}

    signature_a, version_a, tags_a = p2verify._tags_of(base_swf)
    signature_b, version_b, tags_b = p2verify._tags_of(patched_swf)
    if (signature_a, version_a) != (signature_b, version_b):
        raise VerifyError("SWF signature/version drifted")
    if len(tags_a) != len(tags_b):
        raise VerifyError("tag count %d -> %d" % (len(tags_a), len(tags_b)))
    differing = [i for i, (a, b) in enumerate(zip(tags_a, tags_b)) if a != b]
    if len(differing) != 1:
        raise VerifyError("expected exactly one differing tag, got %r" % (differing,))
    main = [i for i, (code, payload) in enumerate(tags_a)
            if code == 82 and len(payload) > 1_000_000]
    if differing[0] != main[0]:
        raise VerifyError("the differing tag is not the main DoABC2")
    report["tags"] = {"total": len(tags_a), "differing": differing}

    name_a, abc_a = p2verify._main_abc(tags_a)
    name_b, abc_b = p2verify._main_abc(tags_b)
    if name_a != name_b:
        raise VerifyError("DoABC2 name drifted %s -> %s" % (name_a, name_b))
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
    if sorted(appended) != sorted(expected_new_strings):
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
        spec = expected_bodies[index]
        a, b = bodies_a[index], bodies_b[index]

        for field in ("method", "initscope", "maxscope", "ex", "traits"):
            if a[field] != b[field]:
                raise VerifyError("body %d (%s): %s drifted %r -> %r"
                                  % (index, spec["name"], field, a[field], b[field]))
        for field in ("maxstack", "localcount"):
            want = spec.get(field)
            want = a[field] if want is None else want
            if b[field] != want:
                raise VerifyError("body %d (%s): %s is %d, expected %d"
                                  % (index, spec["name"], field, b[field], want))

        listing_a = p2verify._normalize(a, pools_a)
        listing_b = p2verify._normalize(b, pools_b)
        for listing, tag in ((listing_a, "baseline"), (listing_b, "patched")):
            bad = [line for line in listing if "!!off-boundary" in line]
            if bad:
                raise VerifyError("body %d (%s, %s): branch off an instruction boundary: %r"
                                  % (index, spec["name"], tag, bad))

        stripped_a = _strip_targets(listing_a)
        stripped_b = _strip_targets(listing_b)
        opcodes = difflib.SequenceMatcher(a=stripped_a, b=stripped_b,
                                          autojunk=False).get_opcodes()
        branch_checks = _check_branch_targets(spec["name"], a, b, opcodes)
        script = [
            (tag, stripped_a[i1:i2], stripped_b[j1:j2])
            for tag, i1, i2, j1, j2 in opcodes
            if tag != "equal"
        ]
        hunks = spec["hunks"]
        if len(script) != len(hunks):
            raise VerifyError("body %d (%s): %d hunks, expected %d:\n%r"
                              % (index, spec["name"], len(script), len(hunks), script))
        inserted_blocks = []
        for (tag, removed, added), (want_tag, want_removed, want_added) in zip(script, hunks):
            if tag != want_tag:
                raise VerifyError("body %d (%s): hunk is %r, expected %r"
                                  % (index, spec["name"], tag, want_tag))
            if removed != want_removed:
                raise VerifyError("body %d (%s): hunk removes %r, expected %r"
                                  % (index, spec["name"], removed, want_removed))
            if len(added) != want_added:
                raise VerifyError("body %d (%s): hunk adds %d lines, expected %d:\n%r"
                                  % (index, spec["name"], len(added), want_added, added))
            if want_tag == "insert":
                inserted_blocks.append(added)
        wanted = spec.get("inserted_mnemonics")
        if wanted is not None:
            got = [_mnemonics(block) for block in inserted_blocks]
            if got != wanted:
                raise VerifyError("body %d (%s): inserted opcodes are\n%r\nexpected\n%r"
                                  % (index, spec["name"], got, wanted))

        interp_a = p2verify._abstract_interpret(a, pools_a)
        interp_b = p2verify._abstract_interpret(b, pools_b)
        for interp, tag in ((interp_a, "baseline"), (interp_b, "patched")):
            if interp["errors"]:
                raise VerifyError("body %d (%s, %s): %r"
                                  % (index, spec["name"], tag, interp["errors"]))
            if interp["max_stack_computed"] > interp["max_stack_declared"]:
                raise VerifyError("body %d (%s, %s): stack overflow %d > %d"
                                  % (index, spec["name"], tag,
                                     interp["max_stack_computed"], interp["max_stack_declared"]))
            if interp["max_scope_computed"] > interp["max_scope_declared"]:
                raise VerifyError("body %d (%s, %s): scope overflow %d > %d"
                                  % (index, spec["name"], tag,
                                     interp["max_scope_computed"], interp["max_scope_declared"]))
        if interp_b["unreachable"] > interp_a["unreachable"]:
            raise VerifyError("body %d (%s): the patch orphaned %d instruction(s)"
                              % (index, spec["name"],
                                 interp_b["unreachable"] - interp_a["unreachable"]))

        body_reports.append({
            "body_index": index,
            "method": spec["name"],
            "code_len": [len(a["code"]), len(b["code"])],
            "header": {
                "maxstack": [a["maxstack"], b["maxstack"]],
                "localcount": [a["localcount"], b["localcount"]],
            },
            "baseline": interp_a,
            "patched": interp_b,
            "branch_targets_rechecked": branch_checks,
            "hunks": [(tag, removed, added) for tag, removed, added in script],
        })
    report["bodies"] = body_reports
    return report
