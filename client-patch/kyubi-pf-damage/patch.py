#!/usr/bin/env python3
"""Generate a strictly V8-based, four-program PF damage patch. Does not build/install APKs."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile

MAIN_1 = "battle/action/skill/action/rare5/fox_oracle_autumn$fox_oracle_autumn_1"
MAIN_2 = "battle/action/skill/action/rare5/fox_oracle_autumn$fox_oracle_autumn_2"
SPECIAL = ("battle/action/skill/action/ability_skill/"
           "ability_skill_fox_oracle_autumn_fever_pf$ability_skill_fox_oracle_autumn_fever_pf")
PURSUIT = ("battle/action/skill/action/ability_skill/"
           "ability_skill_fox_oracle_autumn_pf_pursuit$ability_skill_fox_oracle_autumn_pf_pursuit")
CLASS_PATHS = {
    "ActionEvaluator": "pinball/scene/battle/battle/action/ActionEvaluator.as",
    "SquadManagerImpl": "pinball/scene/battle/battle/squad/SquadManagerImpl.as",
    "MemberImpl": "pinball/scene/battle/battle/squad/member/MemberImpl.as",
}
# Exported directly with FFDec 24.0.1 from V8 SWF c1c0782b...; newline-normalized.
V8_SHA256 = {
    "ActionEvaluator": "dfa9715e08d23f519fe1b64265572e4b8b4bb78ff3062db425b572c569cede48",
    "SquadManagerImpl": "07cf6f7cdb08041406adc4ba9f7fffbc660259e4a174545aaac97a8d5a93ab20",
    "MemberImpl": "45062a18201685c159aaa2c6327b998accdcb732f67564f0f6ad573217d4ab41",
}


class PatchError(ValueError):
    """Unexpected source or partially patched source must not be rewritten."""


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _one(text: str, old: str, new: str) -> str:
    if text.count(old) != 1:
        raise PatchError(f"expected one exact anchor, found {text.count(old)}: {old[:80]!r}")
    return text.replace(old, new, 1)


def _check(expression: str, paths: tuple[str, ...]) -> str:
    return " || ".join(f'{expression} == "{path}"' for path in paths)


def _rules(name: str) -> list[tuple[str, str]]:
    if name == "SquadManagerImpl":
        rules = []
        for main, expression, indent in (
            ("true", "_loc3_.selfActionSkill.values.program_path", "            "),
            ("false", "_loc30_.values.program_path", "                  "),
        ):
            anchor = f'{indent}"kind":ActionKind.ActionSkill(param2,{main}),'
            extra = (f'\n{indent}"kyubiPfDamage":{_check(expression, (MAIN_1, MAIN_2))},'
                     f'\n{indent}"kyubiPfChargeLv":1,')
            rules.append((anchor, anchor + extra))
        return rules
    if name == "MemberImpl":
        field = "      public var source:SquadMemberSource;"
        signature = "      public function startPowerFlip(param1:PowerFlipLogic, param2:int, param3:Option) : void"
        helper = """      public function kyubiGetPowerFlipChargeLv() : int
      {
         var _loc1_:Option = squad.getLeader();
         if(_loc1_.index == 0)
         {
            return int(Math.max(1,Math.min(3,int(_loc1_.params[0].kyubiLastPowerFlipChargeLv))));
         }
         return 1;
      }
      
"""
        start = ("         if(isLeader())\n         {\n"
                 "            _loc4_ = battle.abilityTotalizer.getPowerFlipOverrides(param2);")
        ability = '                  "kind":ActionKind.AbilitySkill(param2),'
        extra = (f'\n                  "kyubiPfDamage":{_check("param3.params[1]", (SPECIAL, PURSUIT))},'
                 '\n                  "kyubiPfChargeLv":kyubiGetPowerFlipChargeLv(),')
        return [
            (field, field + "\n      \n      public var kyubiLastPowerFlipChargeLv:int = 1;"),
            (signature, helper + signature),
            (start, "         kyubiLastPowerFlipChargeLv = param2;\n" + start),
            (ability, ability + extra),
        ]
    if name == "ActionEvaluator":
        anchor = "               _loc63_ = _loc62_.index == 5;"
        extra = """
               if("kyubiPfDamage" in get_context() && Boolean(get_context().kyubiPfDamage))
               {
                  _loc63_ = true;
                  _loc4_ = false;
                  _loc5_ = false;
                  _loc24_ = int(get_context().kyubiPfChargeLv);
                  if(_loc24_ < 1 || _loc24_ > 3)
                  {
                     _loc24_ = 1;
                  }
               }"""
        return [(anchor, anchor + extra)]
    raise PatchError(f"unsupported class: {name}")


def unpatch_source(name: str, text: str) -> str:
    """Reverse only the exact generated edits and prove the complete V8 source identity."""
    for old, new in reversed(_rules(name)):
        text = _one(text, new, old)
    if _hash(text) != V8_SHA256[name]:
        raise PatchError(f"{name}: reversed source is not the approved V8 export")
    return text


def patch_source(name: str, text: str) -> str:
    text = text.replace("\r\n", "\n")
    if name not in V8_SHA256:
        raise PatchError(f"unsupported class: {name}")
    if "kyubiPf" in text or "kyubiLastPowerFlip" in text:
        unpatch_source(name, text)
        return text
    if _hash(text) != V8_SHA256[name]:
        raise PatchError(f"{name}: unknown source hash {_hash(text)}; re-export the approved V8 APK")
    result = text
    for old, new in _rules(name):
        result = _one(result, old, new)
    if unpatch_source(name, result) != text:
        raise PatchError("the edit escaped its exact source anchors")
    return result


def _atomic(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".kyubi-pf-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, type=Path, help="V8 exported scripts root")
    parser.add_argument("--out-dir", required=True, type=Path, help="new generated scripts root")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.source_dir.resolve() == args.out_dir.resolve():
        raise PatchError("source and generated directories must be different")
    planned = []
    for name, relative in CLASS_PATHS.items():
        source = (args.source_dir / relative).read_text(encoding="utf-8-sig")
        generated = patch_source(name, source)
        destination = args.out_dir / relative
        if destination.exists() and destination.read_text(encoding="utf-8-sig") != generated:
            raise PatchError(f"refusing to overwrite an unrelated output: {destination}")
        planned.append((destination, generated))
    if not args.dry_run:
        for destination, generated in planned:
            _atomic(destination, generated.encode("utf-8"))
    print(json.dumps({"dry_run": args.dry_run, "classes": [
        {"path": str(path), "sha256": _hash(content)} for path, content in planned
    ]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
