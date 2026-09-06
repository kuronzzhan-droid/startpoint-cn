#!/usr/bin/env python3
"""Generate exact V9 source edits for the private Kyubi PF combo snapshot."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

CAPABILITY = "kyubi-pf-initial-combo-v1"
PRIVATE_PF = "override_fox_oracle_autumn_dual_pf"
V9_SWF_SHA256 = "10e7257703364619cb2241979dfdb1c66307531508ee1fb95406fbe8b9890388"
CLASS_PATHS = {
    "BallImpl": "pinball/scene/battle/battle/squad/ball/BallImpl.as",
    "ActionEvaluationResolver": "pinball/scene/battle/battle/action/ActionEvaluationResolver.as",
}
V9_SOURCE_SHA256 = {
    "BallImpl": "250b562b469149d7fac46b6dc216ea9f20386bf28095886dcbfba1c004f94806",
    "ActionEvaluationResolver": "be60fafc72022dabdc9cb49c80bcdec74774fb1985c87d52167f7bf2fd48861a",
}


class PatchError(ValueError):
    """Refuse unknown V9 input, partial patches and ambiguous anchors."""


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _one(text: str, old: str, new: str) -> str:
    if text.count(old) != 1:
        raise PatchError(f"expected one exact source anchor, found {text.count(old)}")
    return text.replace(old, new, 1)


def rules(name: str):
    if name == "BallImpl":
        field = "      public var suppressSkillFrame:int;"
        capture = "            _loc6_ = comboCalculator.getCombo();"
        return [
            (field, field + "\n      \n      public var kyubiPowerFlipInitialCombo:int = 0;"),
            (capture, capture + "\n            kyubiPowerFlipInitialCombo = MaskGeneral.maskBit ^ _loc6_;"),
        ]
    if name == "ActionEvaluationResolver":
        imported = "   import pinball.scene.battle.battle.squad.ball.Ball;"
        anchor = "         initialCombo = MaskGeneral.maskBit ^ comboCalculator.getCombo();"
        extra = f"""
         if(param5.kind.index == 5 && param5.kind.params[0] == "{PRIVATE_PF}" &&
            param5.type.index == 2 && param5.type.params[0] is BallImpl)
         {{
            initialCombo = (param5.type.params[0] as BallImpl).kyubiPowerFlipInitialCombo;
         }}"""
        return [
            (imported, imported + "\n   import pinball.scene.battle.battle.squad.ball.BallImpl;"),
            (anchor, anchor + extra),
        ]
    raise PatchError(f"unsupported class: {name}")


def unpatch_source(name: str, text: str) -> str:
    for old, new in reversed(rules(name)):
        text = _one(text, new, old)
    if digest(text) != V9_SOURCE_SHA256[name]:
        raise PatchError(f"{name}: reversing edits did not reproduce the exact V9 export")
    return text


def patch_source(name: str, text: str) -> str:
    text = text.replace("\r\n", "\n")
    if name not in CLASS_PATHS:
        raise PatchError(f"unsupported class: {name}")
    if "kyubiPowerFlipInitialCombo" in text:
        unpatch_source(name, text)
        return text
    if digest(text) != V9_SOURCE_SHA256[name]:
        raise PatchError(f"{name}: unrecognized V9 source hash {digest(text)}")
    result = text
    for old, new in rules(name):
        result = _one(result, old, new)
    if unpatch_source(name, result) != text:
        raise PatchError("patch escaped its exact source anchors")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="FFDec V9 exported scripts root")
    parser.add_argument("--output", type=Path, required=True, help="separate generated scripts root")
    args = parser.parse_args()
    source, output = args.source.resolve(strict=True), args.output.resolve()
    if output == source or output.is_relative_to(source):
        raise PatchError("output must be separate from the immutable V9 export")
    generated = {}
    for name, relative in CLASS_PATHS.items():
        path = (source / relative).resolve(strict=True)
        if not path.is_relative_to(source):
            raise PatchError("source symlink escapes the export")
        generated[name] = patch_source(name, path.read_text(encoding="utf-8"))
    for name, text in generated.items():
        target = (output / CLASS_PATHS[name]).resolve()
        if not target.is_relative_to(output):
            raise PatchError("output symlink escapes generated scripts root")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8", newline="\n")
        if target.read_text(encoding="utf-8") != text:
            raise OSError("generated source readback mismatch")
    print(json.dumps({"capability": CAPABILITY, "private_pf": PRIVATE_PF,
                      "generated": {name: digest(text) for name, text in generated.items()}}, indent=2))


if __name__ == "__main__":
    main()
