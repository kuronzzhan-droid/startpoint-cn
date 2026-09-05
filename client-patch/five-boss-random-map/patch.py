#!/usr/bin/env python3
"""Randomise the BothBoss map pick for the five-boss gauntlet (quests 1099001..1099099).

Official behaviour (unchanged for every other BothBoss quest, e.g. Solas):
``BothBossTool.mapBoss`` resolves the per-viewer boss pair by walking the
``both_boss_map`` rows of the entry quest **in ascending id order** and taking the
**first** row whose ``BothBossMapLogic.getAvailableBothBoss`` / ``...Single`` returns
``Some``.  With one conditional row per leader damage archetype plus one
unconditional fallback row placed last, that makes the map a pure function of the
leader's build: the same party always fights the same pair.

This patch keeps that walk but, **only** when the entry quest id is in
``[1099001, 1099099]``:

1. it collects *every* row that returned ``Some`` instead of stopping at the first;
2. it splits them into "conditional hits" (the row declares at least one
   ``party_condition_kindN`` and its ``test()`` passes, i.e. the ``Some`` came from
   the conditional branch) and "unconditional / default hits" (everything else);
3. the candidate pool is the conditional hits when that set is non-empty, otherwise
   the unconditional hits;
4. one element is drawn from the pool with a seeded index; an empty pool falls
   through to the official "nothing pushed" path.

Seeding
-------
Multiplayer: ``roomNumber | round | entryQuestId``.  ``roomNumber`` is read at the
``mapBoss`` call site from the ``BattleConnectionConfig`` that is already in a local
there -- ``GlobalLogic`` exposes no cooperation-room getter, so ``bothBossMap`` gains a
trailing optional ``String`` parameter and the single official call site passes it.
All three inputs are identical on every client in the room, so every client derives
the same index for the same viewer; that is what keeps the locally-computed map in
sync across the room (the official code relies on the same determinism).

Single player: ``String(Date.getTime()) | -1 | entryQuestId``.  Nothing has to agree
with anyone else, so wall-clock milliseconds are the entropy source.

The hash is djb2 masked to 31 bits.  It deliberately avoids ``uint``/``>>>`` and any
product above 2**53 so the result is exactly reproducible under any conforming AS3
implementation and never negative, which makes ``seed % length`` a valid index.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Iterable, Sequence


QUEST_ID_MIN = 1_099_001
QUEST_ID_MAX = 1_099_099

CLASS_NAME = "BothBossTool"
OUTPUT_NAME = f"{CLASS_NAME}.as"
QUALIFIED_CLASS = "pinball.scene.battle.battle.BothBossTool"

MARKER_BEGIN = "WF_FIVE_BOSS_RANDOM_MAP_BEGIN"
MARKER_END = "WF_FIVE_BOSS_RANDOM_MAP_END"
MARKER_SINGLE_BEGIN = "WF_FIVE_BOSS_RANDOM_MAP_SINGLE_BEGIN"
MARKER_SINGLE_END = "WF_FIVE_BOSS_RANDOM_MAP_SINGLE_END"
MARKERS = (MARKER_BEGIN, MARKER_END, MARKER_SINGLE_BEGIN, MARKER_SINGLE_END)

DJB2_SEED = 5381
DJB2_MULTIPLIER = 33
INT31_MASK = 2_147_483_647

# --------------------------------------------------------------------------------------
# Anchor 1: the single official call site inside mapBoss().
# --------------------------------------------------------------------------------------

ORIGINAL_CALLSITE = "BothBossTool.bothBossMap(param3,_loc10_.questId,param2)"
PATCHED_CALLSITE = (
    "BothBossTool.bothBossMap(param3,_loc10_.questId,param2,_loc10_.roomNumber)"
)

# --------------------------------------------------------------------------------------
# Anchor 2: the whole official bothBossMap() body (multiplayer path).
# --------------------------------------------------------------------------------------

ORIGINAL_BOTH_BOSS_MAP = """      public static function bothBossMap(param1:Array, param2:MultiQuestIdKind, param3:GlobalLogic) : Option
      {
         var _loc4_:* = null as BothBossMapRepository;
         var _loc5_:* = null as Array;
         var _loc6_:* = null as Array;
         var _loc7_:int = 0;
         var _loc8_:* = null;
         var _loc9_:* = null as BothBossMapTranslator;
         var _loc10_:int = 0;
         var _loc11_:* = null as BothBossMapLogic;
         var _loc12_:* = null as Option;
         var _loc13_:* = null;
         if(param2.index == 4)
         {
            _loc4_ = new BothBossMapRepository(param3.logicAssets,param3);
            _loc5_ = _loc4_.getBothBossMap(int(param2.params[0]));
            _loc6_ = [];
            _loc7_ = 0;
            while(_loc7_ < int(param1.length))
            {
               _loc8_ = param1[_loc7_];
               _loc7_++;
               _loc9_ = new BothBossMapTranslator(_loc8_.party,param3.logicAssets);
               _loc10_ = 0;
               while(_loc10_ < int(_loc5_.length))
               {
                  _loc11_ = _loc5_[_loc10_];
                  _loc10_++;
                  _loc12_ = _loc11_.getAvailableBothBoss(_loc9_,Number(_loc8_.viewerId));
                  if(_loc12_.index == 0)
                  {
                     switch(_loc12_.index)
                     {
                        case 0:
                           _loc13_ = _loc12_.params[0];
                           break;
                        case 1:
                           Boot.lastError = new Error();
                           throw "No Value(f8ce8390-af35-4a8d-b28d-e7cdbccc9fb9)";
                     }
                     _loc6_.push(_loc13_);
                     break;
                  }
               }
            }
            return Option.Some(_loc6_);
         }
         return Option.None;
      }"""

# Injected comments stay ASCII-only: FFDec recompiles this text and we do not want to
# depend on its handling of non-ASCII bytes.  The Chinese rationale lives in README.md.
PATCHED_BOTH_BOSS_MAP = """      // WF_FIVE_BOSS_RANDOM_MAP_BEGIN
      // Five-boss gauntlet map randomisation.  Everything below is inert for any
      // BothBoss entry quest outside 1099001..1099099 (official Solas etc. keep the
      // "first row that returns Some wins" walk, byte for byte in behaviour).
      public static function isRandomMapQuest(param1:int) : Boolean
      {
         if(param1 >= 1099001 && param1 <= 1099099)
         {
            return true;
         }
         return false;
      }

      // A row is "conditional" when it declares at least one party_condition_kindN.
      // Typed Object on purpose: the property chain stays a runtime lookup so the
      // recompiler never has to resolve BothBossMapValues' traits.
      public static function isConditionalRow(param1:Object) : Boolean
      {
         var _loc2_:Object = param1.values;
         if(_loc2_.party_condition_kind1.index == 0)
         {
            return true;
         }
         if(_loc2_.party_condition_kind2.index == 0)
         {
            return true;
         }
         if(_loc2_.party_condition_kind3.index == 0)
         {
            return true;
         }
         if(_loc2_.party_condition_kind4.index == 0)
         {
            return true;
         }
         if(_loc2_.party_condition_kind5.index == 0)
         {
            return true;
         }
         return false;
      }

      // djb2 masked to 31 bits: int-only, every product stays below 2^53 and the
      // result is never negative, so `seed % length` is a valid array index on any
      // conforming AS3 runtime.
      public static function mapSeed(param1:String, param2:int, param3:int) : int
      {
         var _loc6_:int = 0;
         var _loc4_:String = param1 + "|" + param2 + "|" + param3;
         var _loc5_:int = 5381;
         _loc6_ = 0;
         while(_loc6_ < int(_loc4_.length))
         {
            _loc5_ = _loc5_ * 33 + int(_loc4_.charCodeAt(_loc6_)) & 2147483647;
            _loc6_++;
         }
         return _loc5_;
      }

      public static function singleMapSeed(param1:int) : int
      {
         var _loc2_:Date = new Date();
         return BothBossTool.mapSeed(String(_loc2_.getTime()),-1,param1);
      }

      public static function randomIndex(param1:int, param2:int) : int
      {
         if(param2 <= 1)
         {
            return 0;
         }
         return param1 % param2;
      }

      // Conditional hits win over unconditional/default hits; null means "no candidate",
      // which reproduces the official "push nothing for this viewer" outcome.
      public static function pickCandidate(param1:Array, param2:Array, param3:int) : Object
      {
         var _loc4_:* = null as Array;
         _loc4_ = param2;
         if(int(param1.length) > 0)
         {
            _loc4_ = param1;
         }
         if(int(_loc4_.length) == 0)
         {
            return null;
         }
         return _loc4_[BothBossTool.randomIndex(param3,int(_loc4_.length))];
      }

      public static function bothBossMap(param1:Array, param2:MultiQuestIdKind, param3:GlobalLogic, param4:String = "") : Option
      {
         var _loc5_:* = null as BothBossMapRepository;
         var _loc6_:* = null as Array;
         var _loc7_:* = null as Array;
         var _loc8_:int = 0;
         var _loc9_:* = null;
         var _loc10_:* = null as BothBossMapTranslator;
         var _loc11_:int = 0;
         var _loc12_:* = null as BothBossMapLogic;
         var _loc13_:* = null as Option;
         var _loc14_:* = null;
         var _loc15_:int = 0;
         var _loc16_:int = 0;
         var _loc17_:Boolean = false;
         var _loc18_:int = 0;
         var _loc19_:* = null as Array;
         var _loc20_:* = null as Array;
         var _loc21_:Object = null;
         if(param2.index == 4)
         {
            _loc15_ = int(param2.params[0]);
            _loc16_ = int(param2.params[2]);
            _loc17_ = BothBossTool.isRandomMapQuest(_loc15_);
            _loc18_ = BothBossTool.mapSeed(param4,_loc16_,_loc15_);
            _loc5_ = new BothBossMapRepository(param3.logicAssets,param3);
            _loc6_ = _loc5_.getBothBossMap(_loc15_);
            _loc7_ = [];
            _loc8_ = 0;
            while(_loc8_ < int(param1.length))
            {
               _loc9_ = param1[_loc8_];
               _loc8_++;
               _loc10_ = new BothBossMapTranslator(_loc9_.party,param3.logicAssets);
               _loc19_ = [];
               _loc20_ = [];
               _loc11_ = 0;
               while(_loc11_ < int(_loc6_.length))
               {
                  _loc12_ = _loc6_[_loc11_];
                  _loc11_++;
                  _loc13_ = _loc12_.getAvailableBothBoss(_loc10_,Number(_loc9_.viewerId));
                  if(_loc13_.index == 0)
                  {
                     switch(_loc13_.index)
                     {
                        case 0:
                           _loc14_ = _loc13_.params[0];
                           break;
                        case 1:
                           Boot.lastError = new Error();
                           throw "No Value(f8ce8390-af35-4a8d-b28d-e7cdbccc9fb9)";
                     }
                     if(!_loc17_)
                     {
                        _loc7_.push(_loc14_);
                        break;
                     }
                     if(BothBossTool.isConditionalRow(_loc12_) && _loc12_.test(_loc10_))
                     {
                        _loc19_.push(_loc14_);
                     }
                     else
                     {
                        _loc20_.push(_loc14_);
                     }
                  }
               }
               if(_loc17_)
               {
                  _loc21_ = BothBossTool.pickCandidate(_loc19_,_loc20_,_loc18_);
                  if(_loc21_ != null)
                  {
                     _loc7_.push(_loc21_);
                  }
               }
            }
            return Option.Some(_loc7_);
         }
         return Option.None;
      }
      // WF_FIVE_BOSS_RANDOM_MAP_END"""

# --------------------------------------------------------------------------------------
# Anchor 3: the whole official bothBossMapSingle() body (single-player path).
# --------------------------------------------------------------------------------------

ORIGINAL_BOTH_BOSS_MAP_SINGLE = """      public static function bothBossMapSingle(param1:Object, param2:SingleBattleIdKind, param3:GlobalLogic) : Array
      {
         var _loc4_:* = null as BothBossMapRepository;
         var _loc5_:* = null as Array;
         var _loc6_:* = null as Array;
         var _loc7_:* = null as BothBossMapTranslator;
         var _loc8_:int = 0;
         var _loc9_:* = null as BothBossMapLogic;
         var _loc10_:* = null as Option;
         var _loc11_:* = null;
         if(param2.index == 16)
         {
            _loc4_ = new BothBossMapRepository(param3.logicAssets,param3);
            _loc5_ = _loc4_.getBothBossMap(int(param2.params[0]));
            _loc6_ = [];
            _loc7_ = new BothBossMapTranslator(param1,param3.logicAssets);
            _loc8_ = 0;
            while(_loc8_ < int(_loc5_.length))
            {
               _loc9_ = _loc5_[_loc8_];
               _loc8_++;
               _loc10_ = _loc9_.getAvailableBothBossSingle(_loc7_,BothBossTool.DEFAULT_VIEWERID);
               if(_loc10_.index == 0)
               {
                  switch(_loc10_.index)
                  {
                     case 0:
                        _loc11_ = _loc10_.params[0];
                        break;
                     case 1:
                        Boot.lastError = new Error();
                        throw "No Value(f8ce8390-af35-4a8d-b28d-e7cdbccc9fb9)";
                  }
                  _loc6_.push(_loc11_);
                  break;
               }
            }
            return _loc6_;
         }
         return [];
      }"""

PATCHED_BOTH_BOSS_MAP_SINGLE = """      // WF_FIVE_BOSS_RANDOM_MAP_SINGLE_BEGIN
      public static function bothBossMapSingle(param1:Object, param2:SingleBattleIdKind, param3:GlobalLogic) : Array
      {
         var _loc4_:* = null as BothBossMapRepository;
         var _loc5_:* = null as Array;
         var _loc6_:* = null as Array;
         var _loc7_:* = null as BothBossMapTranslator;
         var _loc8_:int = 0;
         var _loc9_:* = null as BothBossMapLogic;
         var _loc10_:* = null as Option;
         var _loc11_:* = null;
         var _loc12_:int = 0;
         var _loc13_:Boolean = false;
         var _loc14_:* = null as Array;
         var _loc15_:* = null as Array;
         var _loc16_:Object = null;
         if(param2.index == 16)
         {
            _loc12_ = int(param2.params[0]);
            _loc13_ = BothBossTool.isRandomMapQuest(_loc12_);
            _loc4_ = new BothBossMapRepository(param3.logicAssets,param3);
            _loc5_ = _loc4_.getBothBossMap(_loc12_);
            _loc6_ = [];
            _loc7_ = new BothBossMapTranslator(param1,param3.logicAssets);
            _loc14_ = [];
            _loc15_ = [];
            _loc8_ = 0;
            while(_loc8_ < int(_loc5_.length))
            {
               _loc9_ = _loc5_[_loc8_];
               _loc8_++;
               _loc10_ = _loc9_.getAvailableBothBossSingle(_loc7_,BothBossTool.DEFAULT_VIEWERID);
               if(_loc10_.index == 0)
               {
                  switch(_loc10_.index)
                  {
                     case 0:
                        _loc11_ = _loc10_.params[0];
                        break;
                     case 1:
                        Boot.lastError = new Error();
                        throw "No Value(f8ce8390-af35-4a8d-b28d-e7cdbccc9fb9)";
                  }
                  if(!_loc13_)
                  {
                     _loc6_.push(_loc11_);
                     break;
                  }
                  if(BothBossTool.isConditionalRow(_loc9_) && _loc9_.test(_loc7_))
                  {
                     _loc14_.push(_loc11_);
                  }
                  else
                  {
                     _loc15_.push(_loc11_);
                  }
               }
            }
            if(_loc13_)
            {
               _loc16_ = BothBossTool.pickCandidate(_loc14_,_loc15_,BothBossTool.singleMapSeed(_loc12_));
               if(_loc16_ != null)
               {
                  _loc6_.push(_loc16_);
               }
            }
            return _loc6_;
         }
         return [];
      }
      // WF_FIVE_BOSS_RANDOM_MAP_SINGLE_END"""


# --------------------------------------------------------------------------------------
# Semantic pins.  Every pin is checked as a token subsequence, so comments and
# whitespace never matter; the read-back variant additionally normalises local /
# parameter names because FFDec renumbers registers when it re-exports.
# --------------------------------------------------------------------------------------

PIN_RANGE_GUARD = "if(param1 >= 1099001 && param1 <= 1099099) { return true; }"
PIN_RANDOM_INDEX = "return param1 % param2;"
PIN_PICK_MODULO = "return _loc4_[BothBossTool.randomIndex(param3,int(_loc4_.length))];"
PIN_MULTI_COLLECT = (
    "if(BothBossTool.isConditionalRow(_loc12_) && _loc12_.test(_loc10_))"
    " { _loc19_.push(_loc14_); } else { _loc20_.push(_loc14_); }"
)
PIN_SINGLE_COLLECT = (
    "if(BothBossTool.isConditionalRow(_loc9_) && _loc9_.test(_loc7_))"
    " { _loc14_.push(_loc11_); } else { _loc15_.push(_loc11_); }"
)
PIN_MULTI_OFFICIAL_PATH = "if(!_loc17_) { _loc7_.push(_loc14_); break; }"
PIN_SINGLE_OFFICIAL_PATH = "if(!_loc13_) { _loc6_.push(_loc11_); break; }"
PIN_MULTI_PICK = "_loc21_ = BothBossTool.pickCandidate(_loc19_,_loc20_,_loc18_);"
PIN_SINGLE_PICK = (
    "_loc16_ = BothBossTool.pickCandidate(_loc14_,_loc15_,"
    "BothBossTool.singleMapSeed(_loc12_));"
)
PIN_SEED_HASH = "_loc5_ = _loc5_ * 33 + int(_loc4_.charCodeAt(_loc6_)) & 2147483647;"
PIN_CALLSITE = PATCHED_CALLSITE

# (label, fingerprint, expected count with markers, expected count after normalisation).
# The two counts differ where the multiplayer and single-player fingerprints collapse
# onto the same token sequence once register numbering is erased.
PINS = (
    ("range guard", PIN_RANGE_GUARD, 1, 1),
    ("randomIndex modulo", PIN_RANDOM_INDEX, 1, 1),
    ("pickCandidate modulo of the pool length", PIN_PICK_MODULO, 1, 1),
    ("multiplayer candidate collection", PIN_MULTI_COLLECT, 1, 2),
    ("single-player candidate collection", PIN_SINGLE_COLLECT, 1, 2),
    ("multiplayer official first-hit path", PIN_MULTI_OFFICIAL_PATH, 1, 2),
    ("single-player official first-hit path", PIN_SINGLE_OFFICIAL_PATH, 1, 2),
    ("multiplayer seeded pick", PIN_MULTI_PICK, 1, 1),
    ("single-player seeded pick", PIN_SINGLE_PICK, 1, 1),
    ("djb2 seed hash", PIN_SEED_HASH, 1, 1),
    ("mapBoss room-number call site", PIN_CALLSITE, 1, 1),
)


class PatchError(RuntimeError):
    """The decompiled source shape or the patched semantics are invalid."""


# --------------------------------------------------------------------------------------
# Executable model of the injected AS3.  The tests exercise this; it is the same
# arithmetic and the same selection rule, so a change here that is not mirrored in the
# AS3 blocks above shows up as a failed pin.
# --------------------------------------------------------------------------------------


def is_random_map_quest(quest_id: int) -> bool:
    """Mirror ``BothBossTool.isRandomMapQuest``."""
    return QUEST_ID_MIN <= quest_id <= QUEST_ID_MAX


def map_seed(room_number: str, round_index: int, quest_id: int) -> int:
    """Mirror ``BothBossTool.mapSeed`` (djb2 masked to 31 bits)."""
    payload = f"{room_number}|{round_index}|{quest_id}"
    value = DJB2_SEED
    for character in payload:
        value = (value * DJB2_MULTIPLIER + ord(character)) & INT31_MASK
    return value


def random_index(seed: int, length: int) -> int:
    """Mirror ``BothBossTool.randomIndex``."""
    if length <= 1:
        return 0
    return seed % length


def pick_candidate(
    conditional: Sequence[object], fallback: Sequence[object], seed: int
) -> object | None:
    """Mirror ``BothBossTool.pickCandidate``."""
    pool = conditional if len(conditional) > 0 else fallback
    if len(pool) == 0:
        return None
    return pool[random_index(seed, len(pool))]


def select_row(
    rows: Iterable[tuple[object, bool, bool]], quest_id: int, seed: int
) -> object | None:
    """Mirror the whole per-viewer selection.

    ``rows`` is the ascending-id row list as ``(payload, returned_some,
    conditional_hit)`` where ``conditional_hit`` means "the row declares at least one
    condition and its test() passed", i.e. the ``Some`` came from the conditional
    branch rather than from the default_quest fallback.
    """
    conditional: list[object] = []
    fallback: list[object] = []
    for payload, returned_some, conditional_hit in rows:
        if not returned_some:
            continue
        if not is_random_map_quest(quest_id):
            return payload
        if conditional_hit:
            conditional.append(payload)
        else:
            fallback.append(payload)
    if not is_random_map_quest(quest_id):
        return None
    return pick_candidate(conditional, fallback, seed)


# --------------------------------------------------------------------------------------
# Text plumbing
# --------------------------------------------------------------------------------------


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


# The 0x... alternative has to come before the decimal rule, or the recompiler's
# `0x7FFFFFFF` would tokenise as `0` followed by the identifier `x7FFFFFFF`.
_TOKEN_RE = re.compile(
    r"//[^\r\n]*|/\*.*?\*/|"
    r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|'
    r"0[xX][0-9A-Fa-f]+|"
    r"[A-Za-z_$][A-Za-z0-9_$]*|"
    r"(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?|"
    r">>>=|===|!==|>>>|<<=|>>=|&&|\|\||==|!=|<=|>=|::|"
    r"\S",
    re.DOTALL,
)

_LOCAL_RE = re.compile(r"^_loc\d+_$")
_PARAM_RE = re.compile(r"^param\d+$")
_INT_RE = re.compile(r"^(?:\d+|0[xX][0-9A-Fa-f]+)$")


def _tokens(text: str) -> tuple[str, ...]:
    return tuple(
        match.group(0)
        for match in _TOKEN_RE.finditer(text)
        if not match.group(0).startswith(("//", "/*"))
    )


def canonical_int(token: str) -> str | None:
    """Decimal form of an integer literal, hex or not; ``None`` if not an integer."""
    if not _INT_RE.match(token):
        return None
    return str(int(token, 16) if token[:2].lower() == "0x" else int(token))


def _normalise(tokens: Sequence[str]) -> tuple[str, ...]:
    """Erase FFDec's register numbering and literal radix so a read-back can be pinned."""
    normalised: list[str] = []
    for token in tokens:
        if _LOCAL_RE.match(token):
            normalised.append("_loc_")
        elif _PARAM_RE.match(token):
            normalised.append("param")
        else:
            normalised.append(canonical_int(token) or token)
    return tuple(normalised)


def _subsequence_count(haystack: Sequence[str], needle: Sequence[str]) -> int:
    width = len(needle)
    if width == 0:
        raise PatchError("empty token fingerprint")
    return sum(
        tuple(haystack[index:index + width]) == tuple(needle)
        for index in range(len(haystack) - width + 1)
    )


def _token_sequence_count(text: str, expected: str) -> int:
    return _subsequence_count(_tokens(text), _tokens(expected))


def _normalised_count(text: str, expected: str) -> int:
    return _subsequence_count(_normalise(_tokens(text)), _normalise(_tokens(expected)))


def _markers_complete(text: str, markers: Sequence[str] = MARKERS) -> bool:
    counts = [text.count(marker) for marker in markers]
    # MARKER_BEGIN/END are substrings of nothing else here, but assert the invariant
    # rather than trusting it.
    if all(count == 0 for count in counts):
        return False
    if any(count != 1 for count in counts):
        raise PatchError(f"partial or duplicate patch markers: {dict(zip(markers, counts))}")
    return True


# --------------------------------------------------------------------------------------
# Verification
# --------------------------------------------------------------------------------------


def verify_both_boss_tool(text: str, *, require_markers: bool = True) -> None:
    """Assert the patched class has exactly the intended semantics.

    ``require_markers=False`` plus the normalised pin comparison makes this usable on
    an FFDec read-back, where every injected comment is gone and the locals may have
    been renumbered.
    """
    has_markers = _markers_complete(text)
    if require_markers and not has_markers:
        raise PatchError(f"{CLASS_NAME} patch markers are required")

    counter = _token_sequence_count if has_markers else _normalised_count

    for label, pin, strict_count, loose_count in PINS:
        wanted = strict_count if has_markers else loose_count
        found = counter(text, pin)
        if found != wanted:
            raise PatchError(f"expected {wanted} {label}, found {found}")

    # The official three-argument call must be gone: leaving it would silently drop the
    # room number and desynchronise the room.
    stale = counter(text, ORIGINAL_CALLSITE)
    if stale != 0:
        raise PatchError(
            f"{stale} unpatched three-argument bothBossMap call site(s) survive"
        )

    # The scope of the whole patch is these two literals; pin them so a single-digit
    # typo cannot slip through the pins above.
    numbers = [value for value in map(canonical_int, _tokens(text)) if value is not None]
    for literal in (str(QUEST_ID_MIN), str(QUEST_ID_MAX)):
        if numbers.count(literal) != 1:
            raise PatchError(
                f"expected exactly one {literal} literal, found {numbers.count(literal)}"
            )
    stray = sorted(
        {
            value
            for value in numbers
            if len(value) == 7
            and value.startswith("1099")
            and value not in (str(QUEST_ID_MIN), str(QUEST_ID_MAX))
        }
    )
    if stray:
        raise PatchError(f"unexpected gauntlet quest-id literals: {stray}")

    # Both entry points must still be reachable and must both be guarded.
    for signature in (
        "public static function bothBossMap",
        "public static function bothBossMapSingle",
        "public static function isRandomMapQuest",
        "public static function isConditionalRow",
        "public static function pickCandidate",
        "public static function mapSeed",
        "public static function singleMapSeed",
        "public static function randomIndex",
    ):
        count = text.count(signature)
        expected = 2 if signature == "public static function bothBossMap" else 1
        # "bothBossMap" is a prefix of "bothBossMapSingle".
        if count != expected:
            raise PatchError(f"expected {expected} `{signature}`, found {count}")

    # The randomisation must be gated: two isRandomMapQuest calls (one per path).
    gate_calls = counter(text, "BothBossTool.isRandomMapQuest(")
    if gate_calls != 2:
        raise PatchError(f"expected two isRandomMapQuest call sites, found {gate_calls}")


_IMPORT_RE = re.compile(r"^\s*import\s+[\w.$]+\s*;\s*$", re.MULTILINE)


def _without_imports(text: str) -> str:
    """Drop the import block.

    The recompiler emits only the imports the class body actually names, so a
    read-back legitimately loses the unused ones the decompiler had printed.  That is
    noise in a body comparison.
    """
    return _IMPORT_RE.sub("", text)


def assert_only_target_sites_changed(original: str, patched: str) -> None:
    """Prove nothing outside the three anchors was touched."""
    newline = _newline(patched)
    restored = patched
    for after, before in (
        (PATCHED_BOTH_BOSS_MAP, ORIGINAL_BOTH_BOSS_MAP),
        (PATCHED_BOTH_BOSS_MAP_SINGLE, ORIGINAL_BOTH_BOSS_MAP_SINGLE),
        (PATCHED_CALLSITE, ORIGINAL_CALLSITE),
    ):
        replaced = restored.replace(
            _with_newline(after, newline), _with_newline(before, newline), 1
        )
        if replaced == restored:
            raise PatchError("cannot undo an anchor; the patch is not reversible")
        restored = replaced
    if restored != original:
        raise PatchError("the patch changed something outside the three anchors")


# --------------------------------------------------------------------------------------
# Patching
# --------------------------------------------------------------------------------------


def patch_both_boss_tool(text: str) -> str:
    if _markers_complete(text):
        verify_both_boss_tool(text)
        return text

    newline = _newline(text)
    patched = text
    for before, after, label in (
        (ORIGINAL_BOTH_BOSS_MAP, PATCHED_BOTH_BOSS_MAP, "official bothBossMap body"),
        (
            ORIGINAL_BOTH_BOSS_MAP_SINGLE,
            PATCHED_BOTH_BOSS_MAP_SINGLE,
            "official bothBossMapSingle body",
        ),
        (ORIGINAL_CALLSITE, PATCHED_CALLSITE, "official bothBossMap call site"),
    ):
        needle = _with_newline(before, newline)
        index = _require_once(patched, needle, label)
        patched = (
            patched[:index]
            + _with_newline(after, newline)
            + patched[index + len(needle):]
        )

    verify_both_boss_tool(patched)
    assert_only_target_sites_changed(text, patched)
    return patched


def verify_readback(readback: str, expected: str, *, allow_reformat: bool = True) -> None:
    """Check a class exported back out of FFDec after the write-back.

    Semantic pins are always enforced (markerless, name-normalised).  Whole-class
    normalised token equality against the generated file is reported but, by default,
    only as a warning: the recompiler legitimately drops comments, renumbers registers
    and re-renders some expressions.
    """
    verify_both_boss_tool(readback, require_markers=False)
    actual = _normalise(_tokens(_without_imports(readback)))
    wanted = _normalise(_tokens(_without_imports(expected)))
    if actual == wanted:
        return
    detail = _first_token_difference(wanted, actual)
    message = f"FFDec read-back is not token-identical to the generated class: {detail}"
    if allow_reformat:
        print(f"warning: {message}", file=sys.stderr)
        return
    raise PatchError(message)


def _first_token_difference(expected: Sequence[str], actual: Sequence[str]) -> str:
    for index in range(max(len(expected), len(actual))):
        left = expected[index] if index < len(expected) else "<end>"
        right = actual[index] if index < len(actual) else "<end>"
        if left != right:
            context = " ".join(expected[max(0, index - 6):index])
            return f"token #{index} expected {left!r} got {right!r} (after ...{context})"
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


def write_outputs(both_boss_tool: Path, output_dir: Path) -> Path:
    text, has_bom = _decode_source(both_boss_tool)
    patched = patch_both_boss_tool(text)
    verify_both_boss_tool(patched)
    if not _markers_complete(text):
        assert_only_target_sites_changed(text, patched)
    output = output_dir / OUTPUT_NAME
    _atomic_write(output, patched, has_bom)
    return output


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--both-boss-tool",
        type=Path,
        help=f"authoritative FFDec {OUTPUT_NAME} (read only)",
    )
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument(
        "--verify",
        type=Path,
        help="verify an already patched class (markerless, for an FFDec read-back)",
    )
    parser.add_argument(
        "--expect",
        type=Path,
        help="with --verify: the generated class to compare tokens against",
    )
    parser.add_argument(
        "--strict-readback",
        action="store_true",
        help="with --verify --expect: promote token inequality to an error",
    )
    args = parser.parse_args(argv)

    if args.verify is not None:
        readback, _ = _decode_source(args.verify)
        if args.expect is not None:
            expected, _ = _decode_source(args.expect)
            verify_readback(
                readback, expected, allow_reformat=not args.strict_readback
            )
        else:
            verify_both_boss_tool(readback, require_markers=False)
        print(f"OK {args.verify.resolve()}")
        return 0

    if args.both_boss_tool is None or args.output_dir is None:
        parser.error("--both-boss-tool and --output-dir are required unless --verify is used")
    output = write_outputs(args.both_boss_tool, args.output_dir)
    print(output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
