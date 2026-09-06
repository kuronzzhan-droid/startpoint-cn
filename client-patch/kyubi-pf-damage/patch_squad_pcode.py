#!/usr/bin/env python3
"""Inject the two skill-context flags without recompiling V8's Seris voice bytecode."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
METHOD_ALIAS = "pinball.scene.battle.battle.squad:SquadManagerImpl/invokeActionSkill"
CLASS_NAME = "pinball.scene.battle.battle.squad.SquadManagerImpl"
CODE_SHA256 = "1e5cfb972f60505ab7dac6284584dcf387e0f5b64bcb0e9813a016b567afd739"
TEXT_SHA256 = "9772da00bc84dc352bc8d4e83abb9bd4ff6f94925c43b129ae10253fef950c3b"
MAIN = "battle/action/skill/action/rare5/fox_oracle_autumn$fox_oracle_autumn_"
Q = 'QName(PackageNamespace(""),"{}")'
CONTEXT_END = ('newobject 12\nconstructprop '
               'QName(PackageNamespace("pinball.scene.battle.battle.action"),"ActionEvaluationResolver"), 5')


class PatchError(ValueError):
    pass


def _load(name):
    path = HERE.parent / "dual-form-v1" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"kyubi_{name}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def extract(text):
    block = _load("pcode_tools").extract_method_block(
        text, trait_kind="method", trait_name="invokeActionSkill")
    return "\n".join(line.strip() for line in block.splitlines()) + "\n"


def _injection(main):
    # Two exact equality comparisons, combined without introducing branch labels.
    load = (["getlocal3", "getproperty " + Q.format("selfActionSkill")]
            if main else ["getlocal 30"])
    load += ["getproperty " + Q.format("values"), "getproperty " + Q.format("program_path")]
    return "\n".join([
        'pushstring "kyubiPfDamage"', *load, f'pushstring "{MAIN}1"', "equals",
        *load, f'pushstring "{MAIN}2"', "equals", "bitor", "convert_b",
        'pushstring "kyubiPfChargeLv"', "pushbyte 1", "newobject 14",
        CONTEXT_END.split("\n", 1)[1],
    ])


def unpatch_method(block):
    for main in (True, False):
        insertion = _injection(main)
        if block.count(insertion) != 1:
            raise PatchError("unknown or incomplete context injection")
        block = block.replace(insertion, CONTEXT_END, 1)
    if block.count("maxstack 33") != 1:
        raise PatchError("unexpected maxstack")
    block = block.replace("maxstack 33", "maxstack 29", 1)
    if hashlib.sha256(block.encode()).hexdigest() != TEXT_SHA256:
        raise PatchError("existing V8 instructions or control flow were changed")
    return block


def patch_method(block):
    if "kyubiPfDamage" in block:
        unpatch_method(block)
        return block
    if hashlib.sha256(block.encode()).hexdigest() != TEXT_SHA256:
        raise PatchError("unknown V8 invokeActionSkill P-code")
    if block.count(CONTEXT_END) != 2 or block.count("maxstack 29") != 1:
        raise PatchError("the two context object shapes are not unique")
    result = block.replace("maxstack 29", "maxstack 33", 1)
    result = result.replace(CONTEXT_END, _injection(True), 1)
    result = result.replace(CONTEXT_END, _injection(False), 1)
    if unpatch_method(result) != block:
        raise PatchError("P-code roundtrip did not preserve all original instructions")
    return result


def canonical(block):
    """FFDec relabels byte offsets after insertion; compare branch structure by label order."""
    labels = {}
    def replace(match):
        key = match.group()
        if key not in labels:
            labels[key] = f"label{len(labels)}"
        return labels[key]
    return re.sub(r"ofs[0-9a-fA-F]+", replace, block)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pcode", type=Path, required=True)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--swf", type=Path)
    parser.add_argument("--verify", type=Path, help="re-exported P-code after replacement")
    args = parser.parse_args()
    expected = patch_method(extract(args.pcode.read_text(encoding="utf-8-sig")))
    if args.verify:
        actual = extract(args.verify.read_text(encoding="utf-8-sig"))
        if canonical(actual) != canonical(expected):
            raise PatchError("re-exported method differs beyond the two exact injections")
        print("OK: original V8 instructions and branch structure preserved")
        return 0
    if not args.out or not args.swf:
        parser.error("generation requires --out and --swf")
    index = _load("abc_methods").index_swf_methods(args.swf)
    ref = index.require_ref(METHOD_ALIAS)
    if hashlib.sha256(ref.code).hexdigest() != CODE_SHA256:
        raise PatchError("the input SWF method is not V8 invokeActionSkill")
    content = expected[expected.index("\nmethod\n") + 1:]
    if args.out.exists() and args.out.read_text(encoding="utf-8-sig") != content:
        raise PatchError("refusing to overwrite unrelated generated P-code")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(content, encoding="utf-8", newline="\n")
    print(json.dumps({"class": CLASS_NAME, "body_index": ref.body_index,
                      "pcode": str(args.out), "source_code_sha256": CODE_SHA256}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
