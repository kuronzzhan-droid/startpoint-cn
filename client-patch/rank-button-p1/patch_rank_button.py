#!/usr/bin/env python3
"""P1 rank-button surgery: pure method-level P-code edits on existing CN classes.

Surgery A  RushEventTopScene/run  : button id list 5 -> 6, plus buttonGroup.get(5).set_enabled(3)
Surgery B  RushEventTopView/run   : one extra addWithConfig(5, getButtonLayer(3,1), buttonSize,
                                     ButtonConfigs.ranking)

No AS3 compiler is involved, no class is added, no constant-pool entry is created
(QName(PackageNamespace(""),"ranking") already exists in the baseline pool and is
already written at boot by boot_ffc6's script initializer).
"""

from __future__ import annotations

import re

class PatchError(RuntimeError):
    pass


# ---------------------------------------------------------------- surgery A --

# id array literal: pushbyte 0..4 ; newarray 5  ->  pushbyte 0..5 ; newarray 6
A1_ANCHOR = """pushbyte 4
newarray 5
constructprop QName(PackageNamespace("pinball.ui.component.button"),"ButtonGroupLogic"), 2"""

A1_REPLACEMENT = """pushbyte 4
pushbyte 5
newarray 6
constructprop QName(PackageNamespace("pinball.ui.component.button"),"ButtonGroupLogic"), 2"""

# grey-out block, copied verbatim from the existing button-3 block (id 3 -> 5, state 2 -> 3)
A2_ANCHOR = """findproperty QName(PackageNamespace(""),"buttonGroup")
getproperty QName(PackageNamespace(""),"buttonGroup")
pushbyte 3
callproperty QName(PackageNamespace(""),"get"), 1
coerce QName(PackageNamespace("pinball.ui.component.button"),"ButtonLogic")
pushbyte 2
callpropvoid QName(PackageNamespace(""),"set_enabled"), 1"""

A2_REPLACEMENT = A2_ANCHOR + """
findproperty QName(PackageNamespace(""),"buttonGroup")
getproperty QName(PackageNamespace(""),"buttonGroup")
pushbyte 5
callproperty QName(PackageNamespace(""),"get"), 1
coerce QName(PackageNamespace("pinball.ui.component.button"),"ButtonLogic")
pushbyte 3
callpropvoid QName(PackageNamespace(""),"set_enabled"), 1"""

# ---------------------------------------------------------------- surgery B --

B_ANCHOR = """getproperty QName(PackageNamespace(""),"rushEventEndlessBattle")
callpropvoid QName(PackageNamespace(""),"addWithConfig"), 4
returnvoid"""

B_REPLACEMENT = """getproperty QName(PackageNamespace(""),"rushEventEndlessBattle")
callpropvoid QName(PackageNamespace(""),"addWithConfig"), 4
getlocal 4
pushbyte 5
getlocal2
pushbyte 3
pushbyte 1
callproperty QName(PackageNamespace(""),"getButtonLayer"), 2
coerce QName(PackageNamespace("starling.display"),"Sprite")
getlocal2
getproperty QName(PackageNamespace(""),"buttonSize")
getlex QName(PackageNamespace("pinball.ui.component.button.config"),"ButtonConfigs")
getproperty QName(PackageNamespace(""),"ranking")
callpropvoid QName(PackageNamespace(""),"addWithConfig"), 4
returnvoid"""


PATCH_SETS = {
    "pinball.scene.event.rush.top:RushEventTopScene/run": [
        ("extend_button_id_array_to_six", A1_ANCHOR, A1_REPLACEMENT),
        ("disable_rank_button_grey", A2_ANCHOR, A2_REPLACEMENT),
    ],
    "pinball.scene.event.rush.top:RushEventTopView/run": [
        ("add_rank_button_slot_3_1", B_ANCHOR, B_REPLACEMENT),
    ],
}

# marker instructions that must NOT already be present in the baseline block
BASELINE_FORBIDDEN = {
    "pinball.scene.event.rush.top:RushEventTopScene/run": ["newarray 6", "pushbyte 5"],
    "pinball.scene.event.rush.top:RushEventTopView/run":
        ['getproperty QName(PackageNamespace(""),"ranking")'],
}

# instruction-level contract the patched block must satisfy
EXPECTED_DELTA = {
    "pinball.scene.event.rush.top:RushEventTopScene/run": {
        "added_lines": 8,     # +1 (pushbyte 5 in the id array) +7 (grey-out block)
        "must_contain": ["newarray 6"],
        "must_not_contain": ["newarray 5"],
    },
    "pinball.scene.event.rush.top:RushEventTopView/run": {
        "added_lines": 12,
        "must_contain": ['getproperty QName(PackageNamespace(""),"ranking")'],
        "must_not_contain": [],
    },
}


def _indent_of(text: str, needle_first_line: str) -> str:
    for line in text.splitlines():
        if line.strip() == needle_first_line:
            return line[: len(line) - len(line.lstrip())]
    raise PatchError(f"cannot determine indentation for {needle_first_line!r}")


def _blockify(text: str, block: str) -> str:
    """Render a multi-line instruction block at the indentation used by *text*."""
    first = block.splitlines()[0]
    indent = _indent_of(text, first)
    return "\n".join(indent + line for line in block.splitlines())


def patch_block(method_name: str, block: str) -> str:
    if method_name not in PATCH_SETS:
        raise PatchError(f"no patch set for {method_name}")
    for token in BASELINE_FORBIDDEN[method_name]:
        if re.search(r"^\s*%s\s*$" % re.escape(token), block, re.MULTILINE):
            raise PatchError(
                f"{method_name}: baseline already contains {token!r}; refusing to double-patch"
            )
    result = block
    for patch_id, anchor, replacement in PATCH_SETS[method_name]:
        anchor_text = _blockify(result, anchor)
        count = result.count(anchor_text)
        if count != 1:
            raise PatchError(
                f"{method_name}: anchor for {patch_id} matched {count} times, expected 1"
            )
        result = result.replace(anchor_text, _blockify(result, replacement), 1)
    _verify(method_name, block, result)
    return result if result.endswith("\n") else result + "\n"


def _verify(method_name: str, baseline: str, patched: str) -> None:
    spec = EXPECTED_DELTA[method_name]
    delta = len(patched.splitlines()) - len(baseline.splitlines())
    if delta != spec["added_lines"]:
        raise PatchError(
            f"{method_name}: line delta {delta}, expected {spec['added_lines']}"
        )
    for token in spec["must_contain"]:
        if not re.search(r"^\s*%s\s*$" % re.escape(token), patched, re.MULTILINE):
            raise PatchError(f"{method_name}: patched block is missing {token!r}")
    for token in spec["must_not_contain"]:
        if re.search(r"^\s*%s\s*$" % re.escape(token), patched, re.MULTILINE):
            raise PatchError(f"{method_name}: patched block still contains {token!r}")
    # body header must be untouched (no maxstack / localcount drift)
    for field in ("maxstack", "localcount", "initscopedepth", "maxscopedepth"):
        b = re.findall(r"^\s*%s\s+(\d+)\s*$" % field, baseline, re.MULTILINE)
        p = re.findall(r"^\s*%s\s+(\d+)\s*$" % field, patched, re.MULTILINE)
        if b != p:
            raise PatchError(f"{method_name}: {field} drifted {b} -> {p}")
