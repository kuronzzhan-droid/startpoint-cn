#!/usr/bin/env python3
"""Make the five-boss gauntlet (quests 1099001..1099003) multi-only in the client.

Patch A rewrites exactly one method:
``pinball.common.data.quest.normal.bossBattle.BossBattleQuestLogic.get_availablePlayKind()``

Official semantics of the return value (``MultiQuestLogic`` domain, *not* the
``EventLogic`` domain which uses a different enum):

    0 = single only
    1 = single and multi          <- official value for every boss battle quest
    2 = multi only                <- official value used by HardMultiEventQuestLogic

``BossBattleModeSelectScene`` disables the single button on 2 and refuses the tap
with ``boss_battle_select_play_single_not_selectable``; every other consumer treats
1 and 2 identically.  Returning 2 for the three gauntlet quests therefore reproduces
the official "hard multi" UX with no new code paths.

The predicate uses the class' own ``id`` field, which the constructor assigns as its
last statement and which sibling methods in the same class (``get_stageNodeId``,
``getQuestNumber``, ``get_multiIdKind``) already read the same way.  It deliberately
does *not* use ``get_stageNodeId()``: that method returns ``floor(id / 1000)`` which is
the composite node id ``1099`` (group 1, node 99), not ``99``, and matching on the node
would also swallow a future ``1099004+`` and break the regression contract that every
quest outside ``1099001..1099003`` keeps returning 1.
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

MARKER_BEGIN = "WF_FIVE_BOSS_MULTI_ONLY_BEGIN"
MARKER_END = "WF_FIVE_BOSS_MULTI_ONLY_END"

METHOD_SIGNATURE = "public function get_availablePlayKind() : int"

# The official method, byte-exact apart from the line terminator.
ORIGINAL_METHOD = (
    "      public function get_availablePlayKind() : int\n"
    "      {\n"
    "         return 1;\n"
    "      }"
)

# Injected comments stay ASCII-only: the FFDec AS3 direct editor recompiles this text
# and we do not want to depend on its handling of non-ASCII bytes.  The Chinese
# rationale lives in README.md instead.
PATCHED_METHOD = (
    "      public function get_availablePlayKind() : int\n"
    "      {\n"
    f"         // {MARKER_BEGIN}\n"
    "         // Five-boss gauntlet (boss battle map group 1 / node 99, quests\n"
    "         // 1099001..1099003) is multi only: 2 == multi only, same value as\n"
    "         // HardMultiEventQuestLogic. Predicate uses the class' own `id` field,\n"
    "         // not get_stageNodeId(): that returns the composite node id 1099, and a\n"
    "         // node-wide match would also capture future 1099004+ quests.\n"
    "         if(id >= 1099001 && id <= 1099003)\n"
    "         {\n"
    "            return 2;\n"
    "         }\n"
    f"         // {MARKER_END}\n"
    "         return 1;\n"
    "      }"
)

# Semantic (comment-free, whitespace-free) fingerprints used for markerless verification
# of an FFDec read-back, where the injected comments no longer exist.
GUARD_CODE = "if(id >= 1099001 && id <= 1099003) { return 2; }"
FALLBACK_CODE = "return 1;"


class PatchError(RuntimeError):
    """The decompiled source shape or the patched semantics are invalid."""


def available_play_kind(quest_id: int) -> int:
    """Mirror the exact predicate injected into AS3.

    Returns 2 (multi only) for the three gauntlet quests, 1 (single and multi,
    the official value) for every other boss battle quest.
    """
    if QUEST_ID_MIN <= quest_id <= QUEST_ID_MAX:
        return PLAY_KIND_MULTI_ONLY
    return PLAY_KIND_SINGLE_AND_MULTI


def is_multi_only(quest_id: int) -> bool:
    return available_play_kind(quest_id) == PLAY_KIND_MULTI_ONLY


def _newline(text: str) -> str:
    if "\r\n" in text:
        return "\r\n"
    if "\r" in text:
        return "\r"
    return "\n"


def _with_newline(block: str, newline: str) -> str:
    return newline.join(block.split("\n"))


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
    if width == 0:
        raise PatchError("empty token fingerprint")
    return sum(
        source[index:index + width] == needle
        for index in range(len(source) - width + 1)
    )


def _token_index(text: str, expected: str) -> int:
    source = _tokens(text)
    needle = _tokens(expected)
    width = len(needle)
    for index in range(len(source) - width + 1):
        if source[index:index + width] == needle:
            return index
    raise PatchError(f"token fingerprint not found: {expected}")


def _markers_complete(text: str, markers: Sequence[str]) -> bool:
    counts = [text.count(marker) for marker in markers]
    if all(count == 0 for count in counts):
        return False
    if any(count != 1 for count in counts):
        raise PatchError(
            f"partial or duplicate patch markers: {dict(zip(markers, counts))}"
        )
    return True


def verify_quest_logic(text: str, *, require_markers: bool = True) -> None:
    """Assert the patched class has exactly the intended semantics.

    With ``require_markers=False`` this works on an FFDec read-back, where the
    recompiler has dropped every injected comment.
    """
    has_markers = _markers_complete(text, (MARKER_BEGIN, MARKER_END))
    if require_markers and not has_markers:
        raise PatchError(f"{CLASS_NAME} patch markers are required")

    signature_count = text.count(METHOD_SIGNATURE)
    if signature_count != 1:
        raise PatchError(
            f"expected one get_availablePlayKind method body, found {signature_count}"
        )

    method_count = _token_sequence_count(text, PATCHED_METHOD)
    if method_count != 1:
        raise PatchError(
            f"expected one semantic patched method, found {method_count}"
        )

    guard_count = _token_sequence_count(text, GUARD_CODE)
    if guard_count != 1:
        raise PatchError(f"expected one multi-only guard, found {guard_count}")

    # `return 2;` must exist only inside the guard, and the official `return 1;`
    # fallback must survive so every other boss battle quest is untouched.
    multi_only_returns = _token_sequence_count(text, "return 2;")
    if multi_only_returns != 1:
        raise PatchError(
            f"expected exactly one `return 2;`, found {multi_only_returns}"
        )
    fallback_returns = _token_sequence_count(text, FALLBACK_CODE)
    if fallback_returns != 1:
        raise PatchError(
            f"expected exactly one `return 1;` fallback, found {fallback_returns}"
        )

    if _token_index(text, GUARD_CODE) >= _token_index(text, FALLBACK_CODE):
        raise PatchError("the multi-only guard must precede the `return 1;` fallback")

    # The quest-id bounds are the whole policy; pin both literals explicitly so a
    # single-digit typo cannot slip through the fingerprints above.
    tokens = _tokens(text)
    if tokens.count(str(QUEST_ID_MIN)) != 1 or tokens.count(str(QUEST_ID_MAX)) != 1:
        raise PatchError(
            f"expected exactly one {QUEST_ID_MIN} and one {QUEST_ID_MAX} literal"
        )


def assert_only_target_method_changed(original: str, patched: str) -> None:
    """Prove no method other than get_availablePlayKind() was touched."""
    newline = _newline(patched)
    restored = patched.replace(_with_newline(PATCHED_METHOD, newline),
                               _with_newline(ORIGINAL_METHOD, newline), 1)
    if restored != original:
        raise PatchError(
            "the patch changed something outside get_availablePlayKind()"
        )


def patch_quest_logic(text: str) -> str:
    if _markers_complete(text, (MARKER_BEGIN, MARKER_END)):
        verify_quest_logic(text)
        return text

    newline = _newline(text)
    original = _with_newline(ORIGINAL_METHOD, newline)
    index = _require_once(text, original, "official get_availablePlayKind body")
    patched = (
        text[:index]
        + _with_newline(PATCHED_METHOD, newline)
        + text[index + len(original):]
    )
    verify_quest_logic(patched)
    assert_only_target_method_changed(text, patched)
    return patched


def verify_readback(readback: str, expected: str, *, allow_reformat: bool = False) -> None:
    """Check a class exported back out of FFDec after the write-back.

    The recompiler drops comments, so markers cannot be required.  Semantic
    verification is always enforced; whole-class token equality against the
    generated file is enforced too unless ``allow_reformat`` relaxes it, in which
    case a mismatch is reported on stderr instead of raising.
    """
    verify_quest_logic(readback, require_markers=False)
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
    assert_only_target_method_changed(text, patched)
    output = output_dir / OUTPUT_NAME
    _atomic_write(output, patched, has_bom)
    return output


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--quest-logic",
        type=Path,
        help=f"authoritative FFDec {OUTPUT_NAME} (read only)",
    )
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument(
        "--verify",
        type=Path,
        help="verify an already patched class (markerless, for FFDec read-back)",
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
            verify_quest_logic(readback, require_markers=False)
        print(f"OK {args.verify.resolve()}")
        return 0

    if args.quest_logic is None or args.output_dir is None:
        parser.error("--quest-logic and --output-dir are required unless --verify is used")
    output = write_outputs(args.quest_logic, args.output_dir)
    print(output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
