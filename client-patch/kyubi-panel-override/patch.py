#!/usr/bin/env python3
"""Generate the exact V10 source edits for the Kyubi ability-panel text override.

The binary patch is produced by pcode.py; this module carries the locked input
hashes and renders the same edit as readable ActionScript so the intent can be
reviewed against the FFDec export. The generated AS3 is never recompiled.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

CAPABILITY = "kyubi-panel-description-override-v1"

# The override is scoped to one character for V11: only ability/leader rows whose
# column-0 string_id starts with this prefix ever reach the master-table probe.
STRING_ID_PREFIX = "fox_oracle_autumn"
KEY_PREFIX = "desc_override_"
GUARD_PREFIX = KEY_PREFIX + STRING_ID_PREFIX

# Locked V10 inputs (base for V11).
V10_APK_SHA256 = "ea5d8413003f1d13c3fcd6ca734e54555264b86a348c48691c8980e0868837c9"
V10_SWF_SHA256 = "c5c349a4b114f922d46dc4db1b55405c3e4ddb9aabb96bb968baaa4092f5214d"

CLASS_PATHS = {
    "AbilityLogic": "pinball/common/data/ability/AbilityLogic.as",
    "LeaderAbilityLogic": "pinball/common/data/ability/LeaderAbilityLogic.as",
}
V10_SOURCE_SHA256 = {
    "AbilityLogic": "2cb601d35ac84547b17db14efa77de71af5c07afb0cc4628a33c0ce9bc94e55f",
    "LeaderAbilityLogic": "e5ef5395e06e89af2732455388bd3ef41d6ce8a5bb67c9d412905aa304b81139",
}

# ABC method-body indices of the four patched methods in the V10 main ABC
# (boot_ffc6). Proven by client-patch/tests/test_kyubi_panel_override.py.
BODY_INDEX = {
    ("AbilityLogic", "getDescriptions"): 7435,
    ("AbilityLogic", "getDescriptionWithSimplify"): 7436,
    ("LeaderAbilityLogic", "getDescriptions"): 7772,
    ("LeaderAbilityLogic", "getDescriptionWithSimplify"): 7773,
}

IMPORT_ANCHOR = {
    "AbilityLogic": "   import pinball.master.generated.AbilityValues;",
    "LeaderAbilityLogic": "   import pinball.master.generated.LeaderAbilityValues;",
}
ADDED_IMPORTS = (
    "\n   import pinball.master.generated.CustomAbilityStringTable;"
    "\n   import pinball.master.generated.SkillReplaceStringTable;"
)

ORIGINAL_GET_DESCRIPTIONS = """      public function getDescriptions() : Array
      {
         return new AbilityGroupingDescriptionGenerator(logicAssets).stringfyWithoutJoin(getDescriptionSources());
      }"""

ORIGINAL_WITH_SIMPLIFY = """      public function getDescriptionWithSimplify(param1:Boolean, param2:Boolean) : String
      {
         var _loc3_:AbilityGroupingDescriptionGenerator = new AbilityGroupingDescriptionGenerator(logicAssets);
         _loc3_.simpleAbilityDescriptionEnabled = param2;
         return _loc3_.stringfy(getDescriptionSources(),param1);
      }"""

_PROBE = """         var _loc{v}_:* = values;
         var _loc{k}_:* = null;
         var _loc{r}_:* = null;
         var _loc{t}_:* = null;{extra}
         if(_loc{v}_ != null && _loc{v}_.length > 0)
         {{
            _loc{k}_ = _loc{v}_[0];
            if(_loc{k}_ != null)
            {{
               _loc{k}_ = "{key_prefix}" + String(_loc{k}_.string_id);
               if(_loc{k}_.indexOf("{guard}") == 0)
               {{
                  _loc{r}_ = logicAssets.getMasterTable(CustomAbilityStringTable).get_data().getMaybe(_loc{k}_);
                  if(_loc{r}_ != null)
                  {{
                     _loc{t}_ = _loc{r}_.string;
                     if(_loc{t}_ != null)
                     {{
{tail}
                     }}
                  }}
               }}
            }}
         }}
"""

_SIMPLE_PASS = """                        if({enabled})
                        {{
                           _loc{i}_ = 0;
                           _loc{l}_ = logicAssets.getMasterTable(SkillReplaceStringTable).get_data();
                           while(_loc{i}_ < int(_loc{l}_.length))
                           {{
                              _loc{e}_ = _loc{l}_[_loc{i}_];
                              _loc{i}_++;
                              _loc{t}_ = _loc{t}_.split(_loc{e}_.substr).join(_loc{e}_.by);
                           }}
                        }}
"""

_TAIL_ARRAY = (_SIMPLE_PASS + """                        return _loc{t}_.split("\\n");""")

_TAIL_STRING = (_SIMPLE_PASS + """                        return _loc{t}_.split("\\n").join(logicAssets.getUiString(param1 ? "ability_description_delimiter_newline" : "ability_description_delimiter"));""")


def _probe_block(*, v, k, r, t, tail, extra=""):
    return _PROBE.format(v=v, k=k, r=r, t=t, tail=tail, extra=extra,
                         key_prefix=KEY_PREFIX, guard=GUARD_PREFIX)


PATCHED_GET_DESCRIPTIONS = (
    "      public function getDescriptions() : Array\n"
    "      {\n"
    + _probe_block(v=1, k=2, r=3, t=4,
                   extra="\n         var _loc5_:int = 0;"
                         "\n         var _loc6_:* = null;"
                         "\n         var _loc7_:* = null;",
                   tail=_TAIL_ARRAY.format(
                       t=4, i=5, l=6, e=7,
                       enabled="logicAssets.getSimpleAbilityDescriptionEnabled()"))
    + "         return new AbilityGroupingDescriptionGenerator(logicAssets)"
      ".stringfyWithoutJoin(getDescriptionSources());\n"
    "      }"
)

PATCHED_WITH_SIMPLIFY = (
    "      public function getDescriptionWithSimplify(param1:Boolean, param2:Boolean) : String\n"
    "      {\n"
    + _probe_block(v=4, k=5, r=6, t=7,
                   extra="\n         var _loc8_:int = 0;"
                         "\n         var _loc9_:* = null;"
                         "\n         var _loc10_:* = null;",
                   tail=_TAIL_STRING.format(t=7, i=8, l=9, e=10, enabled="param2"))
    + "         var _loc3_:AbilityGroupingDescriptionGenerator = "
      "new AbilityGroupingDescriptionGenerator(logicAssets);\n"
    "         _loc3_.simpleAbilityDescriptionEnabled = param2;\n"
    "         return _loc3_.stringfy(getDescriptionSources(),param1);\n"
    "      }"
)


class PatchError(ValueError):
    """Refuse unknown input, partial patches and ambiguous anchors."""


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _one(text: str, old: str, new: str) -> str:
    if text.count(old) != 1:
        raise PatchError(f"expected one exact source anchor, found {text.count(old)}")
    return text.replace(old, new, 1)


def rules(name: str):
    if name not in CLASS_PATHS:
        raise PatchError(f"unsupported class: {name}")
    anchor = IMPORT_ANCHOR[name]
    return [
        (anchor, anchor + ADDED_IMPORTS),
        (ORIGINAL_GET_DESCRIPTIONS, PATCHED_GET_DESCRIPTIONS),
        (ORIGINAL_WITH_SIMPLIFY, PATCHED_WITH_SIMPLIFY),
    ]


def unpatch_source(name: str, text: str) -> str:
    for old, new in reversed(rules(name)):
        text = _one(text, new, old)
    if digest(text) != V10_SOURCE_SHA256[name]:
        raise PatchError(f"{name}: reversing edits did not reproduce the exact V10 export")
    return text


def patch_source(name: str, text: str) -> str:
    text = text.replace("\r\n", "\n")
    if name not in CLASS_PATHS:
        raise PatchError(f"unsupported class: {name}")
    if GUARD_PREFIX in text:
        unpatch_source(name, text)
        return text
    if digest(text) != V10_SOURCE_SHA256[name]:
        raise PatchError(f"{name}: unrecognized V10 source hash {digest(text)}")
    result = text
    for old, new in rules(name):
        result = _one(result, old, new)
    if unpatch_source(name, result) != text:
        raise PatchError("patch escaped its exact source anchors")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="FFDec V10 exported scripts root")
    parser.add_argument("--output", type=Path, required=True, help="separate generated scripts root")
    args = parser.parse_args()
    source, output = args.source.resolve(strict=True), args.output.resolve()
    if output == source or output.is_relative_to(source):
        raise PatchError("output must be separate from the immutable V10 export")
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
    print(json.dumps({"capability": CAPABILITY, "key_prefix": KEY_PREFIX,
                      "guard_prefix": GUARD_PREFIX,
                      "generated": {name: digest(text) for name, text in generated.items()}},
                     indent=2))


if __name__ == "__main__":
    main()
