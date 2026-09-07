#!/usr/bin/env python3
"""Splice the panel-override prologue into four V10 method bodies as FFDec P-code.

No AS3 is recompiled. Each target block is SHA-256 locked against the V10 export,
each splice is idempotent and exactly reversible, and every multiname the new code
uses is already present in the V10 constant pool (asserted by verify.py).

The locked block hashes describe the **input** (the untouched V10 export), so they
stay valid across guard changes; what the splice writes is re-derived from
`patch.STRING_ID_PREFIX` on every run and re-checked by verify.py.
"""
from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

from patch import GUARD_PREFIX, KEY_PREFIX, PatchError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dual-form-v1"))
import pcode_tools  # noqa: E402  (path set above)

# ---------------------------------------------------------------------------
# Multiname spellings copied verbatim from the V10 FFDec export so the assembler
# reuses existing constant-pool entries instead of adding new ones.
PUBLIC = 'QName(PackageNamespace(""),"%s")'
AS3 = 'QName(Namespace("http://adobe.com/AS3/2006/builtin"),"%s")'
CONTAINER = 'QName(Namespace("pinball.asset.logic:ILogicAssetContainer"),"%s")'
GENERATED = 'QName(PackageNamespace("pinball.master.generated"),"%s")'
ARRAY_GET = 'getproperty MultinameL([PackageNamespace("","1")])'

SKIP = "PanelOverrideSkip"
LOOP = "PanelOverrideReplace"
TEST = "PanelOverrideReplaceTest"
JOIN = "PanelOverrideJoin"
PLAIN = "PanelOverridePlainDelimiter"
DELIMITED = "PanelOverrideDelimited"


def _get(index: int) -> str:
    return "getlocal%d" % index if index <= 3 else "getlocal %d" % index


def _set(index: int) -> str:
    return "setlocal%d" % index if index <= 3 else "setlocal %d" % index


def probe(base: int) -> list[str]:
    """values[0].string_id -> desc_override_<id> -> CustomAbilityStringTable row.

    Every step fails open: a null field, an empty values array, a string_id outside
    the guarded prefix, an unloaded master table or a missing table row jumps to SKIP
    and the untouched original body runs.

    V14 probes every non-null string_id, so the table lookup can no longer hide
    behind a character prefix.  It therefore goes through `getMasterTableMaybe`,
    which `LogicAssetContainer` (the container the running game uses) answers with
    null instead of `throw new ClientError(8013)` when the table is not in the
    current scene's asset caches.  The official precedent for exactly this shape is
    `TrimmedImageRepository`'s constructor.  `row` holds the table first and the row
    second, so no extra local is needed and localcount is unchanged.
    """
    values, key, row, text = base, base + 1, base + 2, base + 3
    return [
        "getlocal0",
        "getproperty " + PUBLIC % "values",
        _set(values),
        _get(values), "pushnull", "ifeq " + SKIP,
        _get(values), "getproperty " + PUBLIC % "length", "pushbyte 0", "ifle " + SKIP,
        _get(values), "pushbyte 0", ARRAY_GET, _set(key),
        _get(key), "pushnull", "ifeq " + SKIP,
        'pushstring "%s"' % KEY_PREFIX,
        _get(key), "getproperty " + PUBLIC % "string_id", "convert_s", "add", _set(key),
        _get(key), 'pushstring "%s"' % GUARD_PREFIX,
        "callproperty " + AS3 % "indexOf" + ", 1", "pushbyte 0", "ifne " + SKIP,
        "getlocal0", "getproperty " + PUBLIC % "logicAssets",
        "getlex " + GENERATED % "CustomAbilityStringTable",
        "callproperty " + CONTAINER % "getMasterTableMaybe" + ", 1",
        _set(row),
        _get(row), "pushnull", "ifeq " + SKIP,
        _get(row),
        "callproperty " + PUBLIC % "get_data" + ", 0",
        _get(key),
        "callproperty " + PUBLIC % "getMaybe" + ", 1",
        _set(row),
        _get(row), "pushnull", "ifeq " + SKIP,
        _get(row), "getproperty " + PUBLIC % "string", _set(text),
        _get(text), "pushnull", "ifeq " + SKIP,
    ]


def simple_pass(base: int, enabled: list[str]) -> list[str]:
    """The simple-mode SkillReplaceStringTable pass the native kind-629 branch runs.

    Mirrors InstantAbilityDescriptionGenerator case 19. StringTools.replace is
    inlined as split/join, which is its entire body (StringTools.as:150-153).
    `enabled` leaves the simple-mode Boolean on the stack: the caller supplies
    whichever source the native code uses for that method.
    """
    text, index, table, entry = base + 3, base + 4, base + 5, base + 6
    return enabled + [
        "iffalse " + JOIN,
        "pushbyte 0", "convert_i", _set(index),
        "getlocal0", "getproperty " + PUBLIC % "logicAssets",
        "getlex " + GENERATED % "SkillReplaceStringTable",
        "callproperty " + CONTAINER % "getMasterTable" + ", 1",
        "callproperty " + PUBLIC % "get_data" + ", 0",
        "coerce " + PUBLIC % "Array", _set(table),
        "jump " + TEST,
        LOOP + ":", "label",
        _get(table), _get(index), ARRAY_GET, _set(entry),
        "inclocal_i %d" % index,
        _get(text), _get(entry), "getproperty " + PUBLIC % "substr",
        "callproperty " + AS3 % "split" + ", 1",
        _get(entry), "getproperty " + PUBLIC % "by",
        "callproperty " + AS3 % "join" + ", 1",
        "coerce " + PUBLIC % "String", _set(text),
        TEST + ":",
        _get(index), _get(table), "getproperty " + PUBLIC % "length", "convert_i",
        "iflt " + LOOP,
        JOIN + ":",
    ]


def descriptions_code(base: int) -> list[str]:
    """getDescriptions(): the override text split into panel lines.

    The native body builds AbilityGroupingDescriptionGenerator, whose constructor
    seeds simpleAbilityDescriptionEnabled from the container
    (AbilityGroupingDescriptionGenerator.as:54), so the override reads simple mode
    from the same place instead of assuming it is off.
    """
    text = base + 3
    container_flag = ["getlocal0", "getproperty " + PUBLIC % "logicAssets",
                      "callproperty " + CONTAINER % "getSimpleAbilityDescriptionEnabled" + ", 0"]
    return probe(base) + simple_pass(base, container_flag) + [
        _get(text), 'pushstring "\\n"', "callproperty " + AS3 % "split" + ", 1",
        "coerce " + PUBLIC % "Array", "returnvalue",
        SKIP + ":",
    ]


def simplify_code(base: int) -> list[str]:
    """getDescriptionWithSimplify(): simple mode from param2, then the delimiter.

    The native body assigns param2 over the constructor's seed, so the override
    reads param2. The delimiter mirrors AbilityGroupingDescriptionGenerator.stringfy
    (AbilityGroupingDescriptionGenerator.as:480-484).
    """
    text = base + 3
    return probe(base) + simple_pass(base, ["getlocal2"]) + [
        _get(text), 'pushstring "\\n"', "callproperty " + AS3 % "split" + ", 1",
        "getlocal0", "getproperty " + PUBLIC % "logicAssets",
        "getlocal1", "iffalse " + PLAIN,
        'pushstring "ability_description_delimiter_newline"', "jump " + DELIMITED,
        PLAIN + ":",
        'pushstring "ability_description_delimiter"',
        DELIMITED + ":",
        "callproperty " + CONTAINER % "getUiString" + ", 1",
        "callproperty " + AS3 % "join" + ", 1",
        "coerce " + PUBLIC % "String", "returnvalue",
        SKIP + ":",
    ]


class Target:
    def __init__(self, cls, method, body_index, block_sha256,
                 old_header, new_header, code):
        self.cls = cls
        self.method = method
        self.body_index = body_index
        self.block_sha256 = block_sha256
        self.old_header = old_header      # (maxstack, localcount)
        self.new_header = new_header
        self.code = code


TARGETS = [
    Target("AbilityLogic", "getDescriptions", 7435,
           "46134ddf368288b1a94054ea82989ae1959d0e146279550bdf853338cf3b9ef7",
           (2, 1), (2, 8), descriptions_code(1)),
    Target("AbilityLogic", "getDescriptionWithSimplify", 7436,
           "fe481cd9b08cdc779ee412a4b72aa3bbd4111f6f1703bb16a59a4e0dc9f937ae",
           (3, 4), (3, 11), simplify_code(4)),
    Target("LeaderAbilityLogic", "getDescriptions", 7772,
           "331ebf61dd4de21bf8110ccab4dd219fb8d74f12e8fe8102647d9dab31c78ad7",
           (2, 1), (2, 8), descriptions_code(1)),
    Target("LeaderAbilityLogic", "getDescriptionWithSimplify", 7773,
           "bfb14f1a62db1eaea635820825e085fe3d96ffdba07dd32f37b41b4c696d6568",
           (3, 4), (3, 11), simplify_code(4)),
]
BY_NAME = {(t.cls, t.method): t for t in TARGETS}


def _indent_of(line: str) -> str:
    return line[: len(line) - len(line.lstrip())]


def _prologue(block: str, target: Target) -> str:
    lines = block.split("\n")
    starts = [n for n, line in enumerate(lines) if line.strip() == "code"]
    if len(starts) != 1:
        raise PatchError("expected exactly one code section")
    first = starts[0] + 1
    if lines[first].strip() != "getlocal0" or lines[first + 1].strip() != "pushscope":
        raise PatchError("body does not open with the expected scope setup")
    indent = _indent_of(lines[first])
    return "".join(indent + statement + "\n" for statement in target.code)


def _header(block: str, maxstack: int, localcount: int, target: Target) -> str:
    lines = block.split("\n")
    replaced = 0
    for n, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("maxstack "):
            lines[n] = _indent_of(line) + "maxstack %d" % maxstack
            replaced += 1
        elif stripped.startswith("localcount "):
            lines[n] = _indent_of(line) + "localcount %d" % localcount
            replaced += 1
    if replaced != 2:
        raise PatchError(f"{target.cls}.{target.method}: expected one maxstack and one localcount")
    return "\n".join(lines)


def unpatch_block(block: str, target: Target) -> str:
    block = block.replace("\r\n", "\n")
    addition = _prologue(block, target)
    if block.count(addition) != 1:
        raise PatchError(f"{target.cls}.{target.method}: partial or unknown P-code patch")
    original = _header(block.replace(addition, "", 1), *target.old_header, target)
    if hashlib.sha256(original.encode()).hexdigest() != target.block_sha256:
        raise PatchError(f"{target.cls}.{target.method}: reversal did not reproduce the V10 block")
    return original


def patch_block(block: str, target: Target) -> str:
    block = block.replace("\r\n", "\n")
    if SKIP in block:
        unpatch_block(block, target)
        return block
    if hashlib.sha256(block.encode()).hexdigest() != target.block_sha256:
        raise PatchError(f"{target.cls}.{target.method}: unrecognized V10 P-code block")
    addition = _prologue(block, target)
    lines = block.split("\n")
    first = [n for n, line in enumerate(lines) if line.strip() == "code"][0] + 1
    spliced = "\n".join(lines[: first + 2]) + "\n" + addition + "\n".join(lines[first + 2:])
    result = _header(spliced, *target.new_header, target)
    if unpatch_block(result, target) != block:
        raise PatchError("splice escaped its exact anchors")
    return result


def extract(source_text: str, target: Target) -> str:
    return pcode_tools.extract_method_block(
        source_text, trait_kind="method", trait_name=target.method).replace("\r\n", "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="FFDec V10 P-code export of the class")
    parser.add_argument("output", type=Path, help="method block to feed to ffdec -replace")
    parser.add_argument("--class-name", required=True, choices=sorted({t.cls for t in TARGETS}))
    parser.add_argument("--method", required=True, choices=sorted({t.method for t in TARGETS}))
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        raise PatchError("the V10 export must remain immutable")
    target = BY_NAME[(args.class_name, args.method)]
    content = patch_block(extract(args.source.read_text(encoding="utf-8"), target), target)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(content, encoding="utf-8", newline="\n")
    print("%s %s body=%d sha256=%s" % (target.cls, target.method, target.body_index,
                                       hashlib.sha256(content.encode()).hexdigest()))


if __name__ == "__main__":
    main()
