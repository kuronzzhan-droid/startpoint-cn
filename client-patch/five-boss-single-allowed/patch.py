#!/usr/bin/env python3
"""Give the five-boss gauntlet (quests 1099001..1099003) the single button back.

This patch is the *inverse* of ``client-patch/five-boss-multi-only`` and is applied
**instead of** it.  It rewrites exactly one method back to its official body:
``pinball.common.data.quest.normal.bossBattle.BossBattleQuestLogic.get_availablePlayKind()``

    0 = single only
    1 = single and multi          <- official value for every boss battle quest
    2 = multi only                <- what five-boss-multi-only injected for 1099001..1099003

Returning 1 for the gauntlet quests is not a new code path: it is the value every
official boss battle quest already returns, including the official BothBoss quests
1001002 / 1001003 (维·索拉斯).  ``BossBattleModeSelectScene`` then enables the single
button and routes the tap to ``startSingleBattle``, and the whole BothBoss round
machinery has explicit single-player branches (``BothBossTool.bothBossMapSingle``,
``BattleScene.preparation``'s ``DEFAULT_VIEWERID``, ``BothBossManager.isSingle``,
``BattleScenePlayingStateImpl.bothBossNext``).  See README.md for the full citation list.

The patcher accepts either input shape and is idempotent:

* the multi-only shape (guard + ``return 2;``), as produced by five-boss-multi-only
  or read back out of a V6/V7 SWF, and
* the official shape (bare ``return 1;``), in which case it is a no-op.

It refuses anything else rather than silently guessing, and it proves that nothing
outside ``get_availablePlayKind()`` moved.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Sequence


QUEST_ID_MIN = 1_099_001
QUEST_ID_MAX = 1_099_003

PLAY_KIND_SINGLE_ONLY = 0
PLAY_KIND_SINGLE_AND_MULTI = 1
PLAY_KIND_MULTI_ONLY = 2

CLASS_NAME = "BossBattleQuestLogic"
OUTPUT_NAME = f"{CLASS_NAME}.as"

METHOD_SIGNATURE = "public function get_availablePlayKind() : int"

# The official method, byte-exact apart from the line terminator.  This is also the
# patch output: "patching" here means restoring the official body.
OFFICIAL_METHOD = (
    "      public function get_availablePlayKind() : int\n"
    "      {\n"
    "         return 1;\n"
    "      }"
)

# The body five-boss-multi-only leaves behind.  Comments are irrelevant to the
# comparison below (the tokenizer drops them), so this single form covers both the
# generated file and an FFDec read-back where the recompiler dropped the markers.
MULTI_ONLY_METHOD = (
    "      public function get_availablePlayKind() : int\n"
    "      {\n"
    "         if(id >= 1099001 && id <= 1099003)\n"
    "         {\n"
    "            return 2;\n"
    "         }\n"
    "         return 1;\n"
    "      }"
)

# Semantic (comment-free, whitespace-free) fingerprint of the restored body.
RESTORED_CODE = "return 1;"


class PatchError(RuntimeError):
    """The decompiled source shape or the patched semantics are invalid."""


def available_play_kind(quest_id: int) -> int:
    """Mirror the predicate that is left in AS3 after this patch.

    Every boss battle quest -- the gauntlet included -- returns 1 (single and multi).
    """
    return PLAY_KIND_SINGLE_AND_MULTI


def is_single_allowed(quest_id: int) -> bool:
    return available_play_kind(quest_id) != PLAY_KIND_MULTI_ONLY


def _newline(text: str) -> str:
    if "\r\n" in text:
        return "\r\n"
    if "\r" in text:
        return "\r"
    return "\n"


def _with_newline(block: str, newline: str) -> str:
    return newline.join(block.split("\n"))


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
    if width == 0:
        raise PatchError("empty token fingerprint")
    return sum(
        source[index:index + width] == needle
        for index in range(len(source) - width + 1)
    )


def _method_span(text: str) -> tuple[int, int]:
    """Byte span of the whole ``get_availablePlayKind`` method, indentation included.

    Starts at the beginning of the line carrying the signature and ends just past the
    brace that closes the body, found by counting braces (the body has no strings,
    comments with braces, or nested functions, but counting is still cheaper than
    trusting a fixed shape).
    """
    signature_count = text.count(METHOD_SIGNATURE)
    if signature_count != 1:
        raise PatchError(
            f"expected one {METHOD_SIGNATURE} declaration, found {signature_count}"
        )
    signature_at = text.index(METHOD_SIGNATURE)
    line_start = text.rfind("\n", 0, signature_at) + 1
    open_at = text.find("{", signature_at)
    if open_at < 0:
        raise PatchError("get_availablePlayKind has no body")
    depth = 0
    for index in range(open_at, len(text)):
        char = text[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return line_start, index + 1
    raise PatchError("unbalanced braces in get_availablePlayKind")


def verify_quest_logic(text: str) -> None:
    """Assert the class exposes exactly the official single-and-multi semantics."""
    start, end = _method_span(text)
    body = text[start:end]
    if _tokens(body) != _tokens(OFFICIAL_METHOD):
        raise PatchError(
            "get_availablePlayKind is not the official `return 1;` body"
        )

    # `return 2;` is the multi-only marker: it must be gone from the entire class.
    multi_only_returns = _token_sequence_count(text, "return 2;")
    if multi_only_returns != 0:
        raise PatchError(
            f"expected no `return 2;` anywhere, found {multi_only_returns}"
        )

    # The official class carries exactly one `return 1;` and it is this method's.
    fallback_returns = _token_sequence_count(text, RESTORED_CODE)
    if fallback_returns != 1:
        raise PatchError(
            f"expected exactly one `return 1;`, found {fallback_returns}"
        )

    # The gauntlet id literals only ever existed inside the multi-only guard.
    tokens = _tokens(text)
    for literal in (QUEST_ID_MIN, QUEST_ID_MAX):
        if tokens.count(str(literal)) != 0:
            raise PatchError(f"quest id literal {literal} still present")


def assert_only_target_method_changed(original: str, patched: str) -> None:
    """Prove no method other than get_availablePlayKind() was touched."""
    original_start, original_end = _method_span(original)
    patched_start, patched_end = _method_span(patched)
    if original[:original_start] != patched[:patched_start]:
        raise PatchError("the patch changed something before get_availablePlayKind()")
    if original[original_end:] != patched[patched_end:]:
        raise PatchError("the patch changed something after get_availablePlayKind()")


def patch_quest_logic(text: str) -> str:
    newline = _newline(text)
    start, end = _method_span(text)
    body = text[start:end]
    body_tokens = _tokens(body)

    official = _with_newline(OFFICIAL_METHOD, newline)
    if body_tokens == _tokens(OFFICIAL_METHOD):
        # Already single-and-multi (official baseline, or this patch re-run).
        verify_quest_logic(text)
        return text
    if body_tokens != _tokens(MULTI_ONLY_METHOD):
        raise PatchError(
            "get_availablePlayKind is neither the official body nor the "
            "five-boss-multi-only body; re-anchor the patch against the new baseline"
        )

    patched = text[:start] + official + text[end:]
    verify_quest_logic(patched)
    assert_only_target_method_changed(text, patched)
    return patched


def verify_readback(readback: str, expected: str, *, allow_reformat: bool = False) -> None:
    """Check a class exported back out of FFDec after the write-back.

    Semantic verification is always enforced; whole-class token equality against the
    generated file is enforced too unless ``allow_reformat`` relaxes it, in which case
    a mismatch is reported on stderr instead of raising.
    """
    verify_quest_logic(readback)
    actual_tokens = _tokens(readback)
    expected_tokens = _tokens(expected)
    if actual_tokens == expected_tokens:
        return
    detail = _first_token_difference(expected_tokens, actual_tokens)
    message = f"FFDec read-back is not token-identical to the generated class: {detail}"
    if allow_reformat:
        print(f"warning: {message}", file=sys.stderr)
        return
    raise PatchError(message)


def _first_token_difference(
    expected: Sequence[str], actual: Sequence[str]
) -> str:
    for index in range(max(len(expected), len(actual))):
        left = expected[index] if index < len(expected) else "<end>"
        right = actual[index] if index < len(actual) else "<end>"
        if left != right:
            context = " ".join(expected[max(0, index - 6):index])
            return (
                f"token #{index} expected {left!r} got {right!r} "
                f"(after ...{context})"
            )
    return "lengths differ but no token mismatch found"


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


def write_outputs(quest_logic: Path, output_dir: Path) -> Path:
    text, has_bom = _decode_source(quest_logic)
    patched = patch_quest_logic(text)
    verify_quest_logic(patched)
    output = output_dir / OUTPUT_NAME
    _atomic_write(output, patched, has_bom)
    return output


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--quest-logic",
        type=Path,
        help=f"FFDec-exported {OUTPUT_NAME} to restore (read only)",
    )
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument(
        "--verify",
        type=Path,
        help="verify an already restored class (for an FFDec read-back)",
    )
    parser.add_argument(
        "--expect",
        type=Path,
        help="with --verify: the generated class to compare tokens against",
    )
    parser.add_argument(
        "--allow-reformat",
        action="store_true",
        help="with --verify --expect: downgrade token inequality to a warning",
    )
    args = parser.parse_args(argv)

    if args.verify is not None:
        readback, _ = _decode_source(args.verify)
        if args.expect is not None:
            expected, _ = _decode_source(args.expect)
            verify_readback(readback, expected, allow_reformat=args.allow_reformat)
        else:
            verify_quest_logic(readback)
        print(f"OK {args.verify.resolve()}")
        return 0

    if args.quest_logic is None or args.output_dir is None:
        parser.error("--quest-logic and --output-dir are required unless --verify is used")
    output = write_outputs(args.quest_logic, args.output_dir)
    print(output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
