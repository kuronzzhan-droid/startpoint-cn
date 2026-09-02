#!/usr/bin/env python3
"""Patch the battle client so manual five-boss starts cannot enable Auto."""
from __future__ import annotations

import argparse
import os
import re
import tempfile
from pathlib import Path
from typing import Sequence


QUEST_ID_MIN = 1_099_001
QUEST_ID_MAX = 1_099_003

BATTLE_FIELD_BEGIN = "WF_FIVE_BOSS_AUTO_LOCK_FIELD_BEGIN"
BATTLE_FIELD_END = "WF_FIVE_BOSS_AUTO_LOCK_FIELD_END"
BATTLE_INIT_BEGIN = "WF_FIVE_BOSS_AUTO_LOCK_INIT_BEGIN"
BATTLE_INIT_END = "WF_FIVE_BOSS_AUTO_LOCK_INIT_END"
BATTLE_GUARD_BEGIN = "WF_FIVE_BOSS_AUTO_LOCK_GUARD_BEGIN"
BATTLE_GUARD_END = "WF_FIVE_BOSS_AUTO_LOCK_GUARD_END"
PAUSE_LOCK_BEGIN = "WF_FIVE_BOSS_AUTO_LOCK_PAUSE_BEGIN"
PAUSE_LOCK_END = "WF_FIVE_BOSS_AUTO_LOCK_PAUSE_END"

FIELD_ANCHOR = "public var isRaid:Boolean;"
INIT_ANCHOR = "if(myBattle.autoplayData.autoButtonMode == true)"
CHANGE_SIGNATURE = "public function changeAutoplayMode(param1:Boolean) : void"
PAUSE_ANCHOR = "_loc6_.isLocked = get_isTutorial() || !get_autoPlayUnlocked();"

FIELD_CODE = "public var fiveBossManualAutoLock:Boolean;"
INIT_CODE = (
    "fiveBossManualAutoLock = questId.index == 1 "
    "&& QuestIdBattleKindTools.toAnyQuestId(questId) >= 1099001 "
    "&& QuestIdBattleKindTools.toAnyQuestId(questId) <= 1099003 "
    "&& !myBattle.autoplayData.autoButtonMode;"
)
GUARD_CODE = """if(param1 && fiveBossManualAutoLock)
{
   showInstantMessage(logic.asset.getUiString("system_lock_auto_play"),InstantMessagePosition.Center);
   return;
}"""
PAUSE_CODE = (
    "_loc6_.isLocked = get_isTutorial() || !get_autoPlayUnlocked() "
    "|| battleScene.fiveBossManualAutoLock;"
)


class PatchError(RuntimeError):
    """The decompiled source shape or patched semantics are invalid."""


def should_lock_auto(quest_id: int, initial_auto_enabled: bool) -> bool:
    """Mirror the exact immutable start-snapshot policy injected into AS3."""
    return QUEST_ID_MIN <= quest_id <= QUEST_ID_MAX and not initial_auto_enabled


def _newline(text: str) -> str:
    if "\r\n" in text:
        return "\r\n"
    if "\r" in text:
        return "\r"
    return "\n"


def _require_once(text: str, needle: str, label: str) -> int:
    count = text.count(needle)
    if count != 1:
        raise PatchError(f"expected one {label}, found {count}")
    return text.index(needle)


_TOKEN_RE = re.compile(
    r"//[^\r\n]*|/\*.*?\*/|"
    r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|'
    r"[A-Za-z_$][A-Za-z0-9_$]*|"
    r"(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?|"
    r">>>=|===|!==|>>>|<<=|>>=|&&|\|\||==|!=|<=|>=|::|"
    r"\S",
    re.DOTALL,
)


def _tokens(text: str) -> tuple[str, ...]:
    return tuple(
        match.group(0)
        for match in _TOKEN_RE.finditer(text)
        if not match.group(0).startswith(("//", "/*"))
    )


def _token_sequence_count(text: str, expected: str) -> int:
    source = _tokens(text)
    needle = _tokens(expected)
    width = len(needle)
    return sum(
        source[index:index + width] == needle
        for index in range(len(source) - width + 1)
    )


def _markers_complete(text: str, markers: Sequence[str]) -> bool:
    counts = [text.count(marker) for marker in markers]
    if all(count == 0 for count in counts):
        return False
    if any(count != 1 for count in counts):
        raise PatchError(f"partial or duplicate patch markers: {dict(zip(markers, counts))}")
    return True


def _marked_block(indent: str, begin: str, code: str, end: str, newline: str) -> str:
    lines = [f"// {begin}", *code.splitlines(), f"// {end}"]
    return newline.join(indent + line for line in lines)


def verify_battle_scene(text: str, *, require_markers: bool = True) -> None:
    markers = (
        BATTLE_FIELD_BEGIN, BATTLE_FIELD_END,
        BATTLE_INIT_BEGIN, BATTLE_INIT_END,
        BATTLE_GUARD_BEGIN, BATTLE_GUARD_END,
    )
    has_markers = _markers_complete(text, markers)
    if require_markers and not has_markers:
        raise PatchError("BattleScene patch markers are required")

    for code, label in (
        (FIELD_CODE, "lock field"),
        (INIT_CODE, "immutable start-snapshot assignment"),
        (GUARD_CODE, "enable-Auto guard"),
    ):
        count = _token_sequence_count(text, code)
        if count != 1:
            raise PatchError(f"expected one semantic {label}, found {count}")

    if text.count("fiveBossManualAutoLock =") != 1:
        raise PatchError("fiveBossManualAutoLock must be assigned exactly once")
    declaration = text.index("fiveBossManualAutoLock:Boolean")
    preparation = _require_once(text, "public function preparation", "preparation method")
    assignment = text.index("fiveBossManualAutoLock =")
    change = _require_once(text, CHANGE_SIGNATURE, "changeAutoplayMode method")
    guard = text.index("param1 && fiveBossManualAutoLock")
    original_change_body = text.index("if(param1)", guard + 1)
    if not declaration < preparation < assignment < change < guard < original_change_body:
        raise PatchError("lock field, snapshot, and guard are not in the required order")


def verify_pause_menu(text: str, *, require_markers: bool = True) -> None:
    markers = (PAUSE_LOCK_BEGIN, PAUSE_LOCK_END)
    has_markers = _markers_complete(text, markers)
    if require_markers and not has_markers:
        raise PatchError("BattlePauseMenu patch markers are required")
    count = _token_sequence_count(text, PAUSE_CODE)
    if count != 1:
        raise PatchError(f"expected one visibly locked Auto switch, found {count}")


def patch_battle_scene(text: str) -> str:
    markers = (
        BATTLE_FIELD_BEGIN, BATTLE_FIELD_END,
        BATTLE_INIT_BEGIN, BATTLE_INIT_END,
        BATTLE_GUARD_BEGIN, BATTLE_GUARD_END,
    )
    if _markers_complete(text, markers):
        verify_battle_scene(text)
        return text

    newline = _newline(text)
    field_index = _require_once(text, FIELD_ANCHOR, "BattleScene field anchor")
    field_line_start = text.rfind(newline, 0, field_index) + len(newline)
    field_indent = text[field_line_start:field_index]
    field_line_end = text.find(newline, field_index)
    if field_line_end < 0:
        raise PatchError("BattleScene field anchor has no following line")
    field_block = _marked_block(
        field_indent, BATTLE_FIELD_BEGIN, FIELD_CODE, BATTLE_FIELD_END, newline
    )
    text = text[:field_line_end] + newline + field_block + text[field_line_end:]

    init_index = _require_once(text, INIT_ANCHOR, "BattleScene initialization anchor")
    init_line_start = text.rfind(newline, 0, init_index) + len(newline)
    init_indent = text[init_line_start:init_index]
    init_block = _marked_block(
        init_indent, BATTLE_INIT_BEGIN, INIT_CODE, BATTLE_INIT_END, newline
    )
    text = text[:init_line_start] + init_block + newline + text[init_line_start:]

    signature_index = _require_once(text, CHANGE_SIGNATURE, "changeAutoplayMode signature")
    open_brace = text.find("{", signature_index + len(CHANGE_SIGNATURE))
    if open_brace < 0:
        raise PatchError("changeAutoplayMode has no opening brace")
    brace_line_end = text.find(newline, open_brace)
    if brace_line_end < 0:
        raise PatchError("changeAutoplayMode opening brace has no body")
    signature_line_start = text.rfind(newline, 0, signature_index) + len(newline)
    method_indent = text[signature_line_start:signature_index] + "   "
    guard_block = _marked_block(
        method_indent, BATTLE_GUARD_BEGIN, GUARD_CODE, BATTLE_GUARD_END, newline
    )
    text = text[:brace_line_end] + newline + guard_block + text[brace_line_end:]
    verify_battle_scene(text)
    return text


def patch_pause_menu(text: str) -> str:
    if _markers_complete(text, (PAUSE_LOCK_BEGIN, PAUSE_LOCK_END)):
        verify_pause_menu(text)
        return text

    newline = _newline(text)
    anchor_index = _require_once(text, PAUSE_ANCHOR, "pause Auto switch anchor")
    line_start = text.rfind(newline, 0, anchor_index) + len(newline)
    indent = text[line_start:anchor_index]
    line_end = text.find(newline, anchor_index)
    if line_end < 0:
        line_end = len(text)
    replacement = _marked_block(
        indent, PAUSE_LOCK_BEGIN, PAUSE_CODE, PAUSE_LOCK_END, newline
    )
    text = text[:line_start] + replacement + text[line_end:]
    verify_pause_menu(text)
    return text


def _decode_source(path: Path) -> tuple[str, bool]:
    raw = path.read_bytes()
    has_bom = raw.startswith(b"\xef\xbb\xbf")
    return raw.decode("utf-8-sig"), has_bom


def _atomic_write(path: Path, text: str, has_bom: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = (("\ufeff" if has_bom else "") + text).encode("utf-8")
    handle, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def write_outputs(battle_source: Path, pause_source: Path, output_dir: Path) -> tuple[Path, Path]:
    battle_text, battle_bom = _decode_source(battle_source)
    pause_text, pause_bom = _decode_source(pause_source)
    patched_battle = patch_battle_scene(battle_text)
    patched_pause = patch_pause_menu(pause_text)
    verify_battle_scene(patched_battle)
    verify_pause_menu(patched_pause)

    battle_output = output_dir / "BattleScene.as"
    pause_output = output_dir / "BattlePauseMenu.as"
    _atomic_write(battle_output, patched_battle, battle_bom)
    _atomic_write(pause_output, patched_pause, pause_bom)
    return battle_output, pause_output


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--battle-scene", type=Path, required=True)
    parser.add_argument("--pause-menu", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    outputs = write_outputs(args.battle_scene, args.pause_menu, args.output_dir)
    for output in outputs:
        print(output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
