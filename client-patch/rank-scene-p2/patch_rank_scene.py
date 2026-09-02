#!/usr/bin/env python3
"""P2 rank-scene surgery: pure method-level P-code edits on the P1 patch output.

Three methods, all of them already-existing CN code.  No class is added, no AS3
is compiled, and the only constant-pool delta is one appended string (surgery D).

    surgery A2'  pinball.scene.event.rush.top:RushEventTopScene/run
                 the button-5 grey-out that P1 added: set_enabled(3) -> set_enabled(1)
                 (3 = grey + not clickable, 1 = normal + clickable; the values come
                  from ButtonEnableStateTools.isEnableUserInput 1/4->true, 2/3->false
                  and ButtonViewBase.setEnabled 1/2->showEnable, 3/4->showDisable)

    surgery C    pinball.scene.event.rush.top:RushEventTopScene/buttonClicked
                 lookupswitch grows from 5 cases to 6, and a new basic block is
                 appended after the trailing `returnvoid`:

                     findproperty  changeSceneWithLoading
                     getlex        pinball.common.data.scene:LoadingTaskKind
                     getproperty   TermsOfService
                     getlex        pinball.common.data.scene:ChangeSceneBackKind
                     getproperty   AddCurrent
                     callpropvoid  changeSceneWithLoading, 2
                     returnvoid

                 That block is a verbatim copy of the live official template in
                 `MenuTopScene.listSelected` (case ofs0127), which reads

                     findproperty  changeSceneWithLoading
                     getlex        LoadingTaskKind
                     getproperty   ProfileGetMyProfile      <- only operand changed
                     getlex        ChangeSceneBackKind
                     getproperty   AddCurrent
                     callpropvoid  changeSceneWithLoading, 2

                 `changeSceneWithLoading(LoadingTaskKind, ChangeSceneBackKind)` is a
                 public method on `LogicScene`, which `RushEventTopScene` extends
                 (RushEventTopScene -> UiScene -> LogicScene), and it has 29 live
                 call sites in this very SWF.

    surgery D    pinball.loading.termsOfService:TermsOfServiceLoadingTask/toolAgreementRemoteInput
                 pushstring "title_name_terms" -> "ranking_ranking_tab_total_ranking"
                 (ui_string: 服务条款 -> 综合排名).  This is the ONLY edit that adds a
                 constant-pool entry: `ranking_ranking_tab_total_ranking` is not in
                 the baseline string pool.  The builder proves the pool grew by
                 exactly one appended string and that every baseline entry is
                 byte-identical.

Why the new block is appended *after* the trailing `returnvoid` rather than
inserted before it: `ofs018a` (that returnvoid) is the target of five existing
jumps.  Appending after it cannot re-route them, and the new block terminates
itself with its own `returnvoid` instead of jumping into shared code.
"""

from __future__ import annotations

import re


class PatchError(RuntimeError):
    pass


SCENE_RUN = "pinball.scene.event.rush.top:RushEventTopScene/run"
SCENE_CLICK = "pinball.scene.event.rush.top:RushEventTopScene/buttonClicked"
TERMS_TASK = "pinball.loading.termsOfService:TermsOfServiceLoadingTask/toolAgreementRemoteInput"

# ---------------------------------------------------------------- surgery A2' --

# The block P1 appended.  Matched in full so the operand edit cannot land on some
# other `pushbyte 3` in the method.
A2_ANCHOR = [
    'findproperty QName(PackageNamespace(""),"buttonGroup")',
    'getproperty QName(PackageNamespace(""),"buttonGroup")',
    "pushbyte 5",
    'callproperty QName(PackageNamespace(""),"get"), 1',
    'coerce QName(PackageNamespace("pinball.ui.component.button"),"ButtonLogic")',
    "pushbyte 3",
    'callpropvoid QName(PackageNamespace(""),"set_enabled"), 1',
]
A2_REPLACEMENT = list(A2_ANCHOR)
A2_REPLACEMENT[5] = "pushbyte 1"

# ------------------------------------------------------------------ surgery C --

C_SWITCH_ANCHOR = "lookupswitch ofs001d, [ofs0021, ofs0091, ofs00c0, ofs0109, ofs010d]"
C_SWITCH_REPLACEMENT = (
    "lookupswitch ofs001d, [ofs0021, ofs0091, ofs00c0, ofs0109, ofs010d, ofsRank]"
)

C_TAIL_LABEL = "ofs018a:"
C_TAIL_INSTRUCTION = "returnvoid"
C_NEW_LABEL = "ofsRank:"
C_NEW_BLOCK = [
    'findproperty QName(PackageNamespace(""),"changeSceneWithLoading")',
    'getlex QName(PackageNamespace("pinball.common.data.scene"),"LoadingTaskKind")',
    'getproperty QName(PackageNamespace(""),"TermsOfService")',
    'getlex QName(PackageNamespace("pinball.common.data.scene"),"ChangeSceneBackKind")',
    'getproperty QName(PackageNamespace(""),"AddCurrent")',
    'callpropvoid QName(PackageNamespace(""),"changeSceneWithLoading"), 2',
    "returnvoid",
]

# ------------------------------------------------------------------ surgery D --

D_ANCHOR = 'pushstring "title_name_terms"'
D_REPLACEMENT = 'pushstring "ranking_ranking_tab_total_ranking"'

# Instructions that must NOT already be present in the baseline block.
BASELINE_FORBIDDEN = {
    SCENE_RUN: [],
    SCENE_CLICK: [C_NEW_LABEL, C_SWITCH_REPLACEMENT,
                  'getproperty QName(PackageNamespace(""),"TermsOfService")'],
    TERMS_TASK: [D_REPLACEMENT],
}

# Instruction-level contract the patched block must satisfy.
EXPECTED_DELTA = {
    SCENE_RUN: {
        "added_lines": 0,
        "must_contain": [],
        "must_not_contain": [],
    },
    SCENE_CLICK: {
        # 1 label + 7 instructions
        "added_lines": 8,
        "must_contain": [C_SWITCH_REPLACEMENT, C_NEW_LABEL,
                         'callpropvoid QName(PackageNamespace(""),"changeSceneWithLoading"), 2'],
        "must_not_contain": [C_SWITCH_ANCHOR],
    },
    TERMS_TASK: {
        "added_lines": 0,
        "must_contain": [D_REPLACEMENT],
        "must_not_contain": [D_ANCHOR],
    },
}


def _indent(line: str) -> str:
    return line[: len(line) - len(line.lstrip())]


def _find_single(lines: list[str], stripped: str) -> int:
    hits = [index for index, line in enumerate(lines) if line.strip() == stripped]
    if len(hits) != 1:
        raise PatchError(f"expected exactly one {stripped!r}, found {len(hits)}")
    return hits[0]


def _find_single_run(lines: list[str], block: list[str]) -> int:
    """Index of the only place where *block* appears as consecutive stripped lines."""
    stripped = [line.strip() for line in lines]
    hits = [
        index
        for index in range(len(stripped) - len(block) + 1)
        if stripped[index: index + len(block)] == block
    ]
    if len(hits) != 1:
        raise PatchError(f"expected exactly one occurrence of the block, found {len(hits)}")
    return hits[0]


def _patch_scene_run(lines: list[str]) -> list[str]:
    start = _find_single_run(lines, A2_ANCHOR)
    out = list(lines)
    for offset, text in enumerate(A2_REPLACEMENT):
        original = out[start + offset]
        out[start + offset] = _indent(original) + text
    return out


def _patch_button_clicked(lines: list[str]) -> list[str]:
    out = list(lines)

    switch_at = _find_single(out, C_SWITCH_ANCHOR)
    out[switch_at] = _indent(out[switch_at]) + C_SWITCH_REPLACEMENT

    label_at = _find_single(out, C_TAIL_LABEL)
    if out[label_at + 1].strip() != C_TAIL_INSTRUCTION:
        raise PatchError(
            f"{C_TAIL_LABEL} is not followed by {C_TAIL_INSTRUCTION!r} "
            f"(found {out[label_at + 1].strip()!r})"
        )
    label_indent = _indent(out[label_at])
    code_indent = _indent(out[label_at + 1])
    if len(code_indent) <= len(label_indent):
        raise PatchError("label / instruction indentation is not what FFDec emits")

    block = [label_indent + C_NEW_LABEL] + [code_indent + text for text in C_NEW_BLOCK]
    return out[: label_at + 2] + block + out[label_at + 2:]


def _patch_terms_task(lines: list[str]) -> list[str]:
    at = _find_single(lines, D_ANCHOR)
    out = list(lines)
    out[at] = _indent(out[at]) + D_REPLACEMENT
    return out


PATCHERS = {
    SCENE_RUN: _patch_scene_run,
    SCENE_CLICK: _patch_button_clicked,
    TERMS_TASK: _patch_terms_task,
}


def patch_block(method_name: str, block: str) -> str:
    """Apply the P2 surgery for *method_name* to one FFDec P-code method block.

    :param method_name: fully qualified ``package:Class/method``.
    :param block: the ``trait method ... end ; method`` text FFDec exported.
    :returns: the patched block, newline-terminated.
    :raises PatchError: on any anchor mismatch, double patch, or contract violation.
    """
    if method_name not in PATCHERS:
        raise PatchError(f"no patch set for {method_name}")

    for token in BASELINE_FORBIDDEN[method_name]:
        if re.search(r"^\s*%s\s*$" % re.escape(token), block, re.MULTILINE):
            raise PatchError(
                f"{method_name}: baseline already contains {token!r}; refusing to double-patch"
            )

    lines = block.splitlines()
    patched = PATCHERS[method_name](lines)
    result = "\n".join(patched)
    _verify(method_name, block, result)
    return result if result.endswith("\n") else result + "\n"


def _verify(method_name: str, baseline: str, patched: str) -> None:
    spec = EXPECTED_DELTA[method_name]
    delta = len(patched.splitlines()) - len(baseline.splitlines())
    if delta != spec["added_lines"]:
        raise PatchError(f"{method_name}: line delta {delta}, expected {spec['added_lines']}")
    for token in spec["must_contain"]:
        if not re.search(r"^\s*%s\s*$" % re.escape(token), patched, re.MULTILINE):
            raise PatchError(f"{method_name}: patched block is missing {token!r}")
    for token in spec["must_not_contain"]:
        if re.search(r"^\s*%s\s*$" % re.escape(token), patched, re.MULTILINE):
            raise PatchError(f"{method_name}: patched block still contains {token!r}")

    # The body header must be untouched: no maxstack / localcount / scope drift.
    for field in ("maxstack", "localcount", "initscopedepth", "maxscopedepth"):
        before = re.findall(r"^\s*%s\s+(\d+)\s*$" % field, baseline, re.MULTILINE)
        after = re.findall(r"^\s*%s\s+(\d+)\s*$" % field, patched, re.MULTILINE)
        if before != after:
            raise PatchError(f"{method_name}: {field} drifted {before} -> {after}")

    # Surgery A2' must land on the button-5 grey-out block and nowhere else.
    # (`pushbyte 5` also occurs in the id-array literal P1 widened to [0..5], so
    #  only the whole seven-instruction block is a safe anchor.)
    if method_name == SCENE_RUN:
        expected = "\n".join(A2_REPLACEMENT)
        flat = "\n".join(line.strip() for line in patched.splitlines())
        if flat.count(expected) != 1:
            raise PatchError("the rank button no longer gets set_enabled(1)")
        old = "\n".join(A2_ANCHOR)
        if old in flat:
            raise PatchError("the grey-out set_enabled(3) block is still present")
