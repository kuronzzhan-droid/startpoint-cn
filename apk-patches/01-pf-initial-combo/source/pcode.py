#!/usr/bin/env python3
"""Patch only the V9 ActionEvaluationResolver constructor; no AS3 recompilation."""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import sys

from patch import PRIVATE_PF, PatchError

METHOD = "pinball.scene.battle.battle.action:ActionEvaluationResolver/ActionEvaluationResolver"
BODY_SHA256 = "417375564f8f453d4ccdf90b189a528e4928ffd73308bb801ebf337f74058c1b"
BLOCK_SHA256 = "c8a86a9ce0c797ff889db89d64300e85628fd127433c27734384be27088534d4"
BALL_METHOD = "pinball.scene.battle.battle.squad.ball:BallImpl/resolveCollisionForPrimaryOrSummons"
BALL_BODY_SHA256 = "8fd6b97bea90790c0cd478cbe0453b2527302611e6354cd7c56a0e6bbae7259b"
BALL_BLOCK_SHA256 = "0701345d6f668a57f0af9bc10f8801ef32ea5ca89d4a0a8b78a8bd53284ce7fb"
INDENT = "                  "
ANCHOR = INDENT + 'initproperty QName(PackageNamespace(""),"initialCombo")\n'
PUBLIC = 'QName(PackageNamespace(""),"%s")'
ARRAY_GET = 'getproperty MultinameL([PackageNamespace("","1")])'
BALL = 'QName(PackageNamespace("pinball.scene.battle.battle.squad.ball"),"BallImpl")'


def _property(name):
    return "getproperty " + PUBLIC % name


def _ball():
    return ["getlocal 5", _property("type"), _property("params"), "pushbyte 0", ARRAY_GET]


def inserted_code():
    commands = ["getlocal 5", _property("kind"), _property("index"), "pushbyte 5",
        "ifne KyubiComboDone", "getlocal 5", _property("kind"), _property("params"),
        "pushbyte 0", ARRAY_GET, f'pushstring "{PRIVATE_PF}"', "ifne KyubiComboDone",
        "getlocal 5", _property("type"), _property("index"), "pushbyte 2",
        "ifne KyubiComboDone", *_ball(), "istype " + BALL, "iffalse KyubiComboDone",
        "getlocal0", *_ball(), "astype " + BALL, _property("kyubiPowerFlipInitialCombo"),
        'setproperty ' + PUBLIC % "initialCombo", "KyubiComboDone:"]
    return "".join(INDENT + command + "\n" for command in commands)


def extract_constructor(source: str):
    signature = "      public function ActionEvaluationResolver("
    if source.count(signature) != 1:
        raise PatchError("expected one resolver constructor in FFDec P-code export")
    head = source.index(signature)
    start = source.index("         method\n", head)
    end = source.index("         end ; method", start) + len("         end ; method")
    return source[start:end] + "\n"


def patch_block(block: str):
    block = block.replace("\r\n", "\n")
    addition = inserted_code()
    original = block
    if "KyubiComboDone" in block:
        if block.count(addition) != 1:
            raise PatchError("partial or unknown resolver P-code patch")
        original = block.replace(addition, "", 1)
    if hashlib.sha256(original.encode()).hexdigest() != BLOCK_SHA256:
        raise PatchError("unrecognized V9 resolver constructor P-code")
    if original.count(ANCHOR) != 1:
        raise PatchError("expected one initialCombo assignment")
    return original.replace(ANCHOR, ANCHOR + addition, 1)


def patch_ball_block(block: str):
    block = block.replace("\r\n", "\n")
    indent = " " * 87
    anchor = (indent + "setlocal 6\n" + indent +
              'findproperty QName(PackageNamespace(""),"isSkillMoving")')
    addition = "".join(indent + command + "\n" for command in (
        "getlocal0", 'getlex QName(PackageNamespace("pinball.common.mask"),"MaskGeneral")',
        _property("maskBit"), "getlocal 6", "bitxor",
        "setproperty " + PUBLIC % "kyubiPowerFlipInitialCombo"))
    original = block
    if "kyubiPowerFlipInitialCombo" in block:
        if block.count(addition) != 1:
            raise PatchError("partial or unknown BallImpl P-code patch")
        original = block.replace(addition, "", 1)
    if hashlib.sha256(original.encode()).hexdigest() != BALL_BLOCK_SHA256:
        raise PatchError("unrecognized V9 collision P-code")
    if original.count(anchor) != 1:
        raise PatchError("expected exactly one pre-expiration combo snapshot")
    return original.replace(anchor, indent + "setlocal 6\n" + addition +
                            indent + 'findproperty QName(PackageNamespace(""),"isSkillMoving")', 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--kind", choices=("resolver", "ball"), default="resolver")
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        raise PatchError("source export must remain immutable")
    source = args.source.read_text(encoding="utf-8")
    if args.kind == "ball":
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dual-form-v1"))
        import pcode_tools
        block = pcode_tools.extract_method_block(source, trait_kind="method",
                                                trait_name="resolveCollisionForPrimaryOrSummons")
        content = patch_ball_block(block)
    else:
        content = patch_block(extract_constructor(source))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(content, encoding="utf-8", newline="\n")
    print(hashlib.sha256(content.encode()).hexdigest())


if __name__ == "__main__":
    main()
