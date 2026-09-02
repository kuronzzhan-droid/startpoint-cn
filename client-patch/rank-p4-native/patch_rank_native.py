#!/usr/bin/env python3
"""P4/S1+S2 surgery: turn the rush "battle history & reset" list into the
official ranking list, purely by editing existing method bodies.

No class, trait, namespace, multiname, int or double is added anywhere.  The
only constant-pool delta is a handful of appended **strings** (the layout slot
names the official cell uses, which the CN build no longer references).

Nine method bodies, in two variants:

    variant "s1"  (fake data, isolates the layout/geometry risk)
        A1   RushEventRankingPartyListCellContentView/run
             the two pushstrings that name the cell layout:
             scene/rush/rush_event_ranking_party + layout/party_list_cell
             ->  scene/rush/rush_event_ranking  + layout/list_cell
        A2   .../apply            render the official row from a flat row object
        A2b  .../resizeWidth      neutralised (see below)
        A3   RushEventRankingPartyListView/createListCell   cell.config.height = 204
        B1   RushEventRankingPartyScene/preparation         allPartyListData = 3 fake rows

    variant "s2"  (real data)
        A1 / A2 / A2b / A3   identical to s1
        B1   .../preparation      allPartyListData = []
        B3   .../afterTransition  fire POST tool/agreement once
        C1   .../copyPlayedParty  repurposed as the response handler
        C2   ToolAgreementRealRemote/successHandler  pass the raw `data` through

    variant "s3"  (sentinel split - the host page keeps working)
        every s2 edit, except that the "always take the new path" predicate
        (`pushfalse / iftrue <original>`) becomes the real sentinel test

            mode.index == 0 && int(mode.params[0]) < 0

        i.e. `RushEventRankingPartyMode.RushBattle(-1)`, which the only live
        entry point (RushEventQuestSelectScene, folderId >= 0) can never build.
        A1 stops rewriting the two pushstrings and prepends a ranking-only
        build instead, so the party layout string is still there for the
        original path.
        D1   RushEventTopScene/buttonClicked   the crown button stops going to
             LoadingTaskKind.TermsOfService and goes straight to
             SceneKind.RushEventRankingParty(eventId, RushBattle(-1), None)
             with ChangeSceneBackKind.AddCurrent (so the *event top* scene kind
             is what lands in backSceneKinds, not the ranking one).

    variant "s4"  (s3 + the parts of the official chrome that are reachable
                   from this host)
        E1   RushEventRankingPartyScene/run   partyList.pagerConfig = Set(100)
             -> the official pager ("1 / N" + arrows) appears
        E2   RushEventRankingPartyView/run    swap the list view's `config` for
             VerticalListViewConfigPreset.rushRanking() *before* the list is
             added (kills the party preset's 180px bottom padding and its
             "no used parties yet" empty-state text), then build the two round
             buttons the official layout has at y=1683
        E3   .../preparation      the button-id array becomes [1, 2] in ranking
             mode (ButtonGroupLogic.get throws ClientError 7504 on an id it was
             never given)
        E4   .../buttonClicked    id 1 -> partyList.changePage(rows.page)
                                  id 2 -> the P2 rich-text page (reward tiers)
        E5   .../copyPlayedParty  also stashes data.page on allPartyListData

Why `resizeWidth` is in the list even though the plan never mentioned it:
`VerticalListCellViewBase.refreshLayout` calls `cellContentContainer.resizeWidth`
on every layout pass, and the CN body reaches for the container `right_align`,
which exists in `layout/party_list_cell` and **not** in `layout/list_cell`.
`UiDisplayObjectContainer.getContainer` throws ClientError(7700) when the name is
missing, so without this edit the very first cell kills the scene.

Why every "disable the original" edit is `pushfalse / iftrue <original>` rather
than a bare `returnvoid`: it keeps the original block a real branch target, so
the AVM2 verifier still walks it, and S3 only has to swap the two-instruction
predicate for the real `RushBattle(-1)` sentinel test.  Nothing is deleted.
"""

from __future__ import annotations

import re


class PatchError(RuntimeError):
    pass


CONTENT = "pinball.scene.event.rush.ranking.party.list.cell._RushEventRankingPartyListCellView.RushEventRankingPartyListCellContentView"
LISTVIEW = "pinball.scene.event.rush.ranking.party.list.RushEventRankingPartyListView"
SCENE = "pinball.scene.event.rush.ranking.party.RushEventRankingPartyScene"
REMOTE = "pinball.remote.tool.agreement.ToolAgreementRealRemote"
TOPSCENE = "pinball.scene.event.rush.top.RushEventTopScene"
VIEW = "pinball.scene.event.rush.ranking.party.RushEventRankingPartyView"

# ---------------------------------------------------------------- constants --

# The official ranking cell's slots.  Text slot -> row field.  Both halves are
# load bearing: the left one is a *string* looked up in the layout at runtime,
# the right one is a *multiname* the bytecode resolves on the row object.  Every
# field name here already exists in the P2 constant pool as
# QName(PackageNamespace(""), name) - that is why they are so short.
TEXT_SLOTS = [
    ("ranking_rank", "rank"),    # 「4337位」/「排名外」
    ("player_rank", "level"),    # 「RANK169」
    ("user_name", "name"),       # player name
    ("kill_count", "count"),     # 「BEST RECORD: 6战」
    ("best_score", "time"),      # 「TIME: 07:19.16」
]

# Party thumbnail containers, in slot order, and the row field holding the path.
THUMB_SLOTS = [
    ("thumbnail000", "a"),
    ("thumbnail001", "b"),
    ("thumbnail002", "c"),
]

THUMBS_CONTAINER = "party_thumbnails"
RANK_FLAG_IMAGE = "rank_label"
THUMB_IMAGE = "image"

# Strings the patch appends to the pool.  Everything else it touches is already
# there.  Kept sorted the way FFDec appends them (first use order) - the builder
# asserts the appended set, not the order, so it is only documentation here.
NEW_STRINGS_COMMON = [
    "ranking_rank",
    "user_name",
    THUMBS_CONTAINER,
    "thumbnail000",
    "thumbnail001",
    "thumbnail002",
]

# S1's fake rows.  Deliberately three *different* rows: one row repeated would
# not prove that per-row data reaches the cell.
FAKE_ROWS = [
    ("1位", True, "RANK169", "假数据甲", "BEST RECORD: 30战", "TIME: 04:17.13"),
    ("2位", True, "RANK88", "假数据乙", "BEST RECORD: 30战", "TIME: 04:34.27"),
    ("排名外", False, "RANK7", "假数据丙", "BEST RECORD: 12战", "TIME: 09:59.99"),
]
FAKE_ROW_FIELDS = ["rank", "visible", "level", "name", "count", "time"]

QN = 'QName(PackageNamespace(""),"%s")'
MN_INDEX = 'MultinameL([PackageNamespace("","1")])'
OPTION = 'QName(PackageNamespace("haxe.ds"),"Option")'
ASSET_GROUP_KIND = 'QName(PackageNamespace("pinball.asset"),"AssetGroupKind")'
BIND2 = 'QName(PackageNamespace("pinball.common.tools._FunctionTools"),"BindImpl2_0")'
PARTY_VIEW = 'QName(PackageNamespace("pinball.scene.event.rush.ranking.party"),"RushEventRankingPartyView")'
CELL_VIEW = 'QName(PackageNamespace("pinball.scene.event.rush.ranking.party.list.cell"),"RushEventRankingPartyListCellView")'
FUNCTION = 'QName(PackageNamespace(""),"Function")'
PAGER_CONFIG = 'QName(PackageNamespace("pinball.ui.component.list.core"),"VerticalListPagerConfig")'
PRESET = 'QName(PackageNamespace("pinball.ui.component.list.core"),"VerticalListViewConfigPreset")'
MODE = 'QName(PackageNamespace("pinball.scene.event.rush.ranking.party"),"RushEventRankingPartyMode")'
SCENE_KIND = 'QName(PackageNamespace("pinball.common.data.scene"),"SceneKind")'
NEXT_KIND = 'QName(PackageNamespace("pinball.common.data.scene"),"ChangeSceneNextKind")'
BACK_KIND = 'QName(PackageNamespace("pinball.common.data.scene"),"ChangeSceneBackKind")'
LOADING_KIND = 'QName(PackageNamespace("pinball.common.data.scene"),"LoadingTaskKind")'
BUTTON_CONFIGS = 'QName(PackageNamespace("pinball.ui.component.button.config"),"ButtonConfigs")'
UI_CONTAINER = 'QName(PackageNamespace("pinball.ui.display"),"UiDisplayObjectContainer")'
UI_PROVIDER_BUILD = 'QName(Namespace("pinball.ui.provider:UiProvider"),"build")'
AS3_PUSH = 'QName(Namespace("http://adobe.com/AS3/2006/builtin"),"push")'
BUTTON_ANIM = ('QName(PackageNamespace("pinball.ui.component.button.behavior"),'
               '"ButtonAnimationBehaviorKind")')
ARRAY = 'QName(PackageNamespace(""),"Array")'

# The ranking cell's own layout, and the empty 126x126 hit-area container the
# official scene_layout uses for its two round buttons.  Both live in the asset
# group SceneKind 77 already preloads (AssetResolver index 56), so nothing new
# has to be downloaded for either of them.
RANK_ASSET_PATH = "scene/rush/rush_event_ranking"
RANK_CELL_LAYOUT = "layout/list_cell"
RANK_BUTTON_LAYOUT = "container/button"

# Button ids for the two round buttons.  `RushEventRankingPartyScene.buttonClicked`
# masks the low 24 bits as a roundNumber and the top nibble as a kind, and every
# kind it knows about is >= 0x10000000, so 1 and 2 cannot collide with a real
# row button.  They are still intercepted in a prologue, because the original
# body *throws* when the low bits do not match a row.
BTN_MY_RANK = 1
BTN_REWARD = 2

# Client-side page size.  MUST equal `NATIVE_PAGE_SIZE` in
# src/lib/rush-leaderboard-agreement.ts - the server computes `data.page` with
# it, and the "my rank" button jumps to that page.
PAGE_SIZE = 100

# The official cell height (`best_score`'s box bottom) and the party cell's own
# height, which `RushEventRankingPartyListCellView`'s constructor puts in
# `config` as `{"height":329, ...}`.  Writing 329 back on the party path is a
# no-op by construction; it is spelled out so the height write can be a single
# unconditional insert whose *value* is what branches.
RANK_CELL_HEIGHT = 204
PARTY_CELL_HEIGHT = 329

# Where the official layout puts the two round buttons (x=94 / x=983 in a
# 1080-wide design, y=1683 in a 1920-tall one).  Expressed against safeArea so a
# device with a notch keeps them inside it.
BTN_LEFT_X = 94
BTN_RIGHT_INSET = 97
BTN_BOTTOM_INSET = 237

# ------------------------------------------------------------------- S5 -----
#
# Geometry taken verbatim from the official `layout/scene_layout` of
# `scene/rush/rush_event_ranking` (decoded, see the plan doc 2.3):
#
#     ranking_layer     ty = 438   guide area 1080 x 1149   <- the list
#     player_layer      ty = 158   guide area 1080 x  275   <- the pinned card
#     update_time_label ty = 104   tx = 540                 <- the black bar
#
# The host (`MenuSceneTemplateView.setupForListOnlyLayout`) starts the list at
# `safeArea.y`, so S5 has to move it down by 438 **and** shrink it by the same
# amount, otherwise the bottom 438 px scroll out of the mask.
# The shrink goes through `VerticalListView.resizeHeight(listSize.height - 438)`
# and NOT through `MenuSceneTemplateView.adjustList`: `getListSize` ends with
# `safeArea.height -= ...` (MenuSceneTemplateView.as:277-278) - it mutates the
# template's own safeArea, so calling it a second time subtracts the
# footer/pager allowance twice (~272 px of list lost).
# Doing it with `listPadding.top` instead would not work either - padding is
# part of the *scrollable content* (`VerticalListView.layoutCells`:614), so the
# rows would just slide up under the bar instead of being clipped by it.
RANKING_LAYER_Y = 438
TIME_BAR_X = 540
TIME_BAR_Y = 104
# player_layer is 275 tall and the cell is 204 -> centred at 158 + 35 = 193.
CARD_Y = 193
# = rushRanking() listPadding.left, so the pinned card lines up with the rows.
CARD_LEFT = 32

# The pinned card's own container, and the light plate behind it.  The list's
# cells get their white panel from `VerticalListCellViewBase` (BottomRightPanelView);
# a standalone layout instance has none, so without this the card would sit
# directly on the page's `coloreaeaea` grey.
RANK_TIME_LAYOUT = "container/time_range_layer"
RANK_CARD_PLATE = "scene/general/sprite_sheet/bg-assets/colorfafafa"

# Row buttons.  The stock `buttonClicked` masks the top nibble as a "kind" and
# every kind it knows is >= 0x20000000 - but on the ranking path the stock body
# is never reached, so small ids are free.  Ids are **page-local**
# (`16 + index % PAGE_SIZE`) so they all fit in a `pushbyte`, which is what
# keeps the int constant pool byte-identical; `buttonClicked` multiplies
# `partyList.currentPageIndex` back in.
ROW_BTN_BASE = 16
ROW_BTN_LIMIT = ROW_BTN_BASE + PAGE_SIZE
# cell height + `rushRanking()` cellVerticalSpace - the pitch `scrollTo` needs.
CELL_PITCH = RANK_CELL_HEIGHT + 16

# Locals the new blocks use.  All of them are dead on the P4 path because the
# original body is only reachable through the `iftrue` that P4 never takes.
L_THIS, L_ARG1, L_ARG2, L_TMP_A, L_TMP_B = 0, 1, 2, 3, 4


def _gl(index: int) -> str:
    """FFDec prints getlocal_0..3 fused and everything else with a space."""
    return "getlocal%d" % index if index <= 3 else "getlocal %d" % index


def _sl(index: int) -> str:
    return "setlocal%d" % index if index <= 3 else "setlocal %d" % index


def _lit(text: str) -> str:
    """FFDec P-code string literal (it escapes exactly like Python's repr sans u)."""
    return '"%s"' % text.replace("\\", "\\\\").replace('"', '\\"')


def _get_field(local: int, field: str) -> list[str]:
    return [_gl(local), "getproperty " + QN % field]


def _layout() -> list[str]:
    return ["findproperty " + QN % "foregroundLayout",
            "getproperty " + QN % "foregroundLayout"]


# ------------------------------------------------------------- the sentinel --

# How each class gets hold of the scene's `RushEventRankingPartyMode`.
#   - the scene itself has it as a field;
#   - the cell content view is handed the scene as `scenePeek`
#     (`RushEventRankingPartyPeek`), and the stock `apply` already reads
#     `scenePeek.mode.index` off it, so the untyped access is proven in this
#     very build;
#   - the scene view is handed the same object as `peek`.
MODE_FROM_SCENE = ["findproperty " + QN % "mode", "getproperty " + QN % "mode"]
MODE_FROM_PEEK = ["findproperty " + QN % "scenePeek",
                  "getproperty " + QN % "scenePeek",
                  "getproperty " + QN % "mode"]
MODE_FROM_VIEW_PEEK = ["findproperty " + QN % "peek",
                       "getproperty " + QN % "peek",
                       "getproperty " + QN % "mode"]


def sentinel_guard(escape: str, loader: list[str]) -> list[str]:
    """Fall through only for `RushEventRankingPartyMode.RushBattle(<negative>)`.

    Two tests, both jumping to *escape* (the untouched original code):

        mode.index != 0                 -> EndlessBattle, or anything new
        int(mode.params[0]) >= 0        -> a real folder id

    The only live constructor of this enum is
    `RushEventQuestSelectScene.as:456`, which passes the scene's own
    `folderId` - a master id, never negative.  `mode.params[0]` has zero read
    sites anywhere in the build, so nothing else can observe the sentinel.

    Why `< 0` rather than `== -1`: it needs no negative literal and no new int
    constant, and it is strictly wider than the value the crown button builds,
    so a future second sentinel cannot fall through by accident.

    `ifnlt` is the negation of `<` (NaN-safe: it jumps, i.e. takes the original
    path, when the comparison is undefined).

    :param escape: label of the original code.
    :param loader: instructions leaving the mode object on the stack.
    :returns: the guard's instructions (peak stack depth 2).
    """
    return (loader
            + ["getproperty " + QN % "index", "pushbyte 0", "ifne " + escape]
            + loader
            + ["getproperty " + QN % "params",
               "pushbyte 0",
               "getproperty " + MN_INDEX,
               "convert_i",
               "pushbyte 0",
               "ifnlt " + escape])


# ------------------------------------------------------------ A2: apply() ----

def _render_text(slot: str, field: str) -> list[str]:
    """foregroundLayout.getText(slot).set_text(row[field])"""
    return (_layout()
            + ["pushstring " + _lit(slot),
               "callproperty " + QN % "getText" + ", 1"]
            + _get_field(L_ARG2, field)
            + ["callpropvoid " + QN % "set_text" + ", 1"])


def _render_rank_flag() -> list[str]:
    """foregroundLayout.getImage("rank_label").visible = row.visible

    The official cell hides the black rank flag for an out-of-ranking row; the
    text slot then reads 「排名外」 instead of 「N位」.
    """
    return (_layout()
            + ["pushstring " + _lit(RANK_FLAG_IMAGE),
               "callproperty " + QN % "getImage" + ", 1"]
            + _get_field(L_ARG2, "visible")
            + ["setproperty " + QN % "visible"])


def _thumb_image(container: str) -> list[str]:
    """Leaves the slot's UiDummyImage on the stack."""
    return (_layout()
            + ["pushstring " + _lit(THUMBS_CONTAINER),
               "callproperty " + QN % "getContainer" + ", 1",
               "pushstring " + _lit(container),
               "callproperty " + QN % "getContainer" + ", 1",
               "pushstring " + _lit(THUMB_IMAGE),
               "callproperty " + QN % "getImage" + ", 1"])


def _render_thumb(index: int, container: str, field: str) -> list[str]:
    """Clear the slot, then kick off an async texture load when the row has a path.

    Two defences are baked in here because both only ever fail on a device:

    1. `changeTexture(Option.None)` first.  `UiDummyImage.render` bails when the
       texture is null, but a recycled cell keeps the *previous* row's texture,
       so an empty slot has to be cleared explicitly rather than left alone.
    2. The completion callback is `apply(index, {p: path, r: row.rank})`, i.e. it
       re-enters this same method through the `row.p` branch, which re-checks
       that the cell still shows the row the load was started for.
    """
    skip = "ofsRankThumbSkip%d" % index
    return (_thumb_image(container)
            + ["coerce_a", _sl(L_TMP_A),
               # 1: clear whatever the recycled cell was showing
               _gl(L_TMP_A),
               "getlex " + OPTION,
               "getproperty " + QN % "None",
               "callpropvoid " + QN % "changeTexture" + ", 1"]
            + _get_field(L_ARG2, field)
            + ["coerce_a", _sl(L_TMP_B),
               _gl(L_TMP_B),
               "pushnull",
               "ifeq " + skip,
               # view.asset.setTexture(CharacterFaceThumbnail, path, cb)
               "findproperty " + QN % "view",
               "getproperty " + QN % "view",
               "getproperty " + QN % "asset",
               "getlex " + ASSET_GROUP_KIND,
               "getproperty " + QN % "CharacterFaceThumbnail",
               _gl(L_TMP_B),
               "findpropstrict " + BIND2,
               "findproperty " + QN % "apply",
               "getproperty " + QN % "apply",
               "coerce " + FUNCTION,
               "pushbyte %d" % index,
               "pushstring " + _lit("p"),
               _gl(L_TMP_B),
               "pushstring " + _lit("r")]
            + _get_field(L_ARG2, "rank")
            + ["newobject 2",
               "constructprop " + BIND2 + ", 3",
               "getproperty " + QN % "execute",
               "coerce " + FUNCTION,
               "callpropvoid " + QN % "setTexture" + ", 3"])


def _register_row_button() -> list[str]:
    """S5: make the whole row a button so tapping it opens that player's profile.

    `param1` is the **global** data index (`VerticalListView.as:494` computes
    `param1 - currentPageIndex * limitPerPage` to find the cell, so the index it
    hands `applyData` is the one into the whole data source).  The id is made
    page-local on purpose - see ROW_BTN_BASE.

    Re-registering the same display object under a new id on a recycled cell is
    exactly what the stock party path does with `0x20000000 | roundNumber`
    (`RushEventRankingPartyListCellContentView.apply`), so this is not a new
    usage pattern for `ButtonGroupView`.
    """
    return (["findproperty " + QN % "buttonGroupView",
             "getproperty " + QN % "buttonGroupView",
             "pushbyte %d" % ROW_BTN_BASE,
             _gl(L_ARG1),
             "pushint %d" % PAGE_SIZE,
             "modulo",
             "add",
             "convert_i"]
            + _layout()
            + ["getlex " + BUTTON_ANIM,
               "getproperty " + QN % "Scale",
               "callpropvoid " + QN % "registerDisplayObjectAsButton" + ", 3"])


def _apply_render_phase(variant: str = "s2") -> list[str]:
    out: list[str] = []
    for slot, field in TEXT_SLOTS:
        out += _render_text(slot, field)
    out += _render_rank_flag()
    for index, (container, field) in enumerate(THUMB_SLOTS):
        out += _render_thumb(index, container, field)
        out.append("ofsRankThumbSkip%d:" % index)
    if variant == "s5":
        out += _register_row_button()
    out.append("returnvoid")
    return out


def _apply_texture_phase() -> list[str]:
    """apply(slotIndex, {p: path, r: rankText}) - the texture-load callback.

    `param1` is the slot index (0..2) and `param2.p` is the path the load was
    started for, which is what tells this phase apart from a normal row render.
    """
    done = "ofsRankTexDone"
    out = [
        # the cell may have been disposed while the texture was in flight
        "findproperty " + QN % "gear",
        "getproperty " + QN % "gear",
        "callproperty " + QN % "checkPhaseBeforeDispose" + ", 0",
        "iffalse " + done,
        # ... or recycled onto another row: the rank text is unique per row, so
        # comparing it against the one captured at request time rejects a late
        # callback that would otherwise paint row A's face onto row B.
    ] + _layout() + [
        "pushstring " + _lit("ranking_rank"),
        "callproperty " + QN % "getText" + ", 1",
        "callproperty " + QN % "get_text" + ", 0",
    ] + _get_field(L_ARG2, "r") + [
        "ifne " + done,
        # slot index -> container name
        _gl(L_ARG1),
        "pushbyte 1",
        "ifeq ofsRankTexSlot1",
        _gl(L_ARG1),
        "pushbyte 2",
        "ifeq ofsRankTexSlot2",
        "pushstring " + _lit(THUMB_SLOTS[0][0]),
        "jump ofsRankTexGo",
        "ofsRankTexSlot1:",
        "pushstring " + _lit(THUMB_SLOTS[1][0]),
        "jump ofsRankTexGo",
        "ofsRankTexSlot2:",
        "pushstring " + _lit(THUMB_SLOTS[2][0]),
        "ofsRankTexGo:",
        "coerce_a",
        _sl(L_TMP_A),
    ] + _layout() + [
        "pushstring " + _lit(THUMBS_CONTAINER),
        "callproperty " + QN % "getContainer" + ", 1",
        _gl(L_TMP_A),
        "callproperty " + QN % "getContainer" + ", 1",
        "pushstring " + _lit(THUMB_IMAGE),
        "callproperty " + QN % "getImage" + ", 1",
        "getlex " + OPTION,
        "findproperty " + QN % "view",
        "getproperty " + QN % "view",
        "getproperty " + QN % "asset",
    ] + _get_field(L_ARG2, "p") + [
        "callproperty " + QN % "getTexture" + ", 1",
        "callproperty " + QN % "Some" + ", 1",
        "callpropvoid " + QN % "changeTexture" + ", 1",
        done + ":",
        "returnvoid",
    ]
    return out


def _predicate(variant: str, escape: str, loader: list[str]) -> list[str]:
    """s1/s2 take the new path unconditionally; s3+ test the sentinel."""
    if variant in ("s1", "s2"):
        return ["pushfalse", "iftrue " + escape]
    return sentinel_guard(escape, loader)


def apply_block(variant: str = "s2") -> list[str]:
    """The whole P4 prologue for `apply`, ending just before the original body."""
    return (_predicate(variant, "ofsRankOldApply", MODE_FROM_PEEK)
            + _get_field(L_ARG2, "p")
            + ["iftrue ofsRankTexPhase"]
            + _apply_render_phase(variant)
            + ["ofsRankTexPhase:"]
            + _apply_texture_phase()
            + ["ofsRankOldApply:"])


def resize_width_block(variant: str = "s2") -> list[str]:
    return (_predicate(variant, "ofsRankOldResize", MODE_FROM_PEEK)
            + ["returnvoid", "ofsRankOldResize:"])


RUN_ASSET_ANCHOR = ["pushstring " + _lit("scene/rush/rush_event_ranking_party")]
RUN_NAME_ANCHOR = ["pushstring " + _lit("layout/party_list_cell")]


def run_asset_replacement() -> list[str]:
    """s3/s4 `run`: pick the cell layout by mode instead of rewriting it.

    s1/s2 swapped the two `pushstring` operands outright, which is one
    instruction cheaper but leaves no way back to `layout/party_list_cell`.
    Here each stock string is kept verbatim as the party branch, and the ranking
    string is the fall-through - so the diff against P2 is two pure inserts and
    the original code is byte-for-byte still there.
    """
    return (sentinel_guard("ofsRankRunPartyAsset", MODE_FROM_PEEK)
            + ["pushstring " + _lit(RANK_ASSET_PATH),
               "jump ofsRankRunAsset",
               "ofsRankRunPartyAsset:"]
            + RUN_ASSET_ANCHOR
            + ["ofsRankRunAsset:"])


def run_name_replacement() -> list[str]:
    return (sentinel_guard("ofsRankRunPartyName", MODE_FROM_PEEK)
            + ["pushstring " + _lit(RANK_CELL_LAYOUT),
               "jump ofsRankRunName",
               "ofsRankRunPartyName:"]
            + RUN_NAME_ANCHOR
            + ["ofsRankRunName:"])


# ------------------------------------------------------- A3: createListCell --

CREATE_CELL_ANCHOR = [
    "findpropstrict " + CELL_VIEW,
    "constructprop " + CELL_VIEW + ", 0",
    "returnvalue",
]
# 204 = the official cell's content height (best_score's box bottom).  The stock
# 329 belongs to the party cell, which is taller because of its button column.
# `config` is a plain Object and every consumer of `config.height` runs after
# `createListCell` returns, so writing it here is enough.
CREATE_CELL_REPLACEMENT = [
    "findpropstrict " + CELL_VIEW,
    "constructprop " + CELL_VIEW + ", 0",
    "dup",
    "getproperty " + QN % "config",
    "pushint %d" % RANK_CELL_HEIGHT,
    "setproperty " + QN % "height",
    "returnvalue",
]

# s3/s4: the height write stays unconditional, only the *value* branches.  The
# party cell's constructor passes `{"height":329, ...}`, so writing 329 back is
# a no-op by construction - which is what lets this be one clean insert with no
# baseline instruction duplicated (see verify_rank_p4's hunk check).
#
# The discriminator is the row object, not the scene mode: `createListCell` is
# handed the row it is about to render, ranking rows carry `rank` and party rows
# do not, and this keeps the height in lockstep with whatever `apply` draws.
CREATE_CELL_HEIGHT_BLOCK = [
    "dup",
    "getproperty " + QN % "config",
    _gl(L_ARG2),
    "pushnull",
    "ifeq ofsRankCellParty",
    _gl(L_ARG2),
    "getproperty " + QN % "rank",
    "pushnull",
    "ifeq ofsRankCellParty",
    "pushint %d" % RANK_CELL_HEIGHT,
    "jump ofsRankCellSet",
    "ofsRankCellParty:",
    "pushint %d" % PARTY_CELL_HEIGHT,
    "ofsRankCellSet:",
    "setproperty " + QN % "height",
]

# ------------------------------------------------------------ B1: rows -------

PREPARATION_ANCHOR = [
    "findproperty " + QN % "allPartyListData",
    "getlocal3",
    "initproperty " + QN % "allPartyListData",
]


def _fake_row(values: tuple) -> list[str]:
    out: list[str] = []
    for field, value in zip(FAKE_ROW_FIELDS, values):
        out.append("pushstring " + _lit(field))
        out.append("pushtrue" if value is True
                   else "pushfalse" if value is False
                   else "pushstring " + _lit(value))
    out.append("newobject %d" % len(FAKE_ROW_FIELDS))
    return out


def preparation_replacement(variant: str) -> list[str]:
    head = ["findproperty " + QN % "allPartyListData"]
    tail = ["initproperty " + QN % "allPartyListData"]
    if variant == "s1":
        body: list[str] = []
        for row in FAKE_ROWS:
            body += _fake_row(row)
        body.append("newarray %d" % len(FAKE_ROWS))
        return head + body + tail
    if variant == "s2":
        return head + ["newarray 0"] + tail
    # s3/s4: the party path keeps `_loc3_` (whatever fromQuestParties /
    # fromRoundParties built); only the ranking path starts empty and waits for
    # the response.  `getlocal3` is kept verbatim so this is a pure insert.
    return (head
            + sentinel_guard("ofsRankPrepParty", MODE_FROM_SCENE)
            + ["newarray 0",
               "jump ofsRankPrepDone",
               "ofsRankPrepParty:"]
            + ["getlocal3", "ofsRankPrepDone:"]
            + tail)


# The button-id array `preparation` hands to `ButtonGroupLogic`.  On the ranking
# path the row loop produces nothing (allPartyListData is empty), so the two
# round buttons have to be put in by hand - `ButtonGroupLogic.get` throws
# ClientError 7504 for an id it was never given, and `ButtonGroupView.
# registerButton` calls it.
PREPARATION_IDS_ANCHOR = [
    "newarray 0",
    'coerce QName(PackageNamespace(""),"Array")',
    "setlocal 4",
]


def preparation_ids_replacement(variant: str = "s4") -> list[str]:
    """The scene's ButtonGroupLogic id array on the ranking path.

    s4: just the two round buttons.
    s5: plus one id per **page slot** (`16 .. 16+PAGE_SIZE-1`) so a row can be
    registered as a button - `ButtonGroupView.addWithConfig` /
    `registerDisplayObjectAsButton` throw ClientError 7504 for an id the logic
    never declared.

    Built with a loop rather than 100 `pushbyte`s so the block stays readable
    and `maxstack` does not have to jump to 102.  The loop bound is 116, which
    fits in a `pushbyte` - that is what keeps the **int constant pool
    byte-identical**, which is one of the verifier's hard invariants.
    """
    if variant != "s5":
        return (sentinel_guard("ofsRankIdsParty", MODE_FROM_SCENE)
                + ["pushbyte %d" % BTN_MY_RANK,
                   "pushbyte %d" % BTN_REWARD,
                   "newarray 2",
                   "jump ofsRankIdsDone",
                   "ofsRankIdsParty:"]
                + PREPARATION_IDS_ANCHOR[:1]
                + ["ofsRankIdsDone:"]
                + PREPARATION_IDS_ANCHOR[1:])

    return (sentinel_guard("ofsRankIdsParty", MODE_FROM_SCENE)
            + ["pushbyte %d" % BTN_MY_RANK,
               "pushbyte %d" % BTN_REWARD,
               "newarray 2",
               "coerce " + ARRAY,
               _sl(4),
               "pushbyte %d" % ROW_BTN_BASE,
               "convert_i",
               _sl(5),
               "ofsRankIdsLoop:",
               _gl(5),
               "pushbyte %d" % ROW_BTN_LIMIT,
               "ifge ofsRankIdsLoopEnd",
               _gl(4),
               _gl(5),
               "callpropvoid " + AS3_PUSH + ", 1",
               _gl(5),
               "increment_i",
               _sl(5),
               "jump ofsRankIdsLoop",
               "ofsRankIdsLoopEnd:",
               _gl(4),
               "jump ofsRankIdsDone",
               "ofsRankIdsParty:"]
            + PREPARATION_IDS_ANCHOR[:1]
            + ["ofsRankIdsDone:"]
            + PREPARATION_IDS_ANCHOR[1:])


# ------------------------------------------------- B3: afterTransition -------

# A verbatim transplant of TermsOfServiceLoadingTask/run (the only live
# tool/agreement caller in the build), with one operand changed: the response
# handler is this scene's `copyPlayedParty` instead of that task's own method.
def after_transition_block(variant: str) -> list[str]:
    """s1/s2 fire unconditionally; s3/s4 only on the sentinel."""
    if variant in ("s1", "s2"):
        return list(AFTER_TRANSITION_BLOCK)
    return sentinel_guard("ofsRankOldAfter", MODE_FROM_SCENE) + AFTER_TRANSITION_BLOCK


AFTER_TRANSITION_BLOCK = [
    # The host list is configured with the *party* preset, whose empty-state
    # placeholder reads 「还没有已用队伍」.  The list is empty until the response
    # lands, so without this the wrong sentence shows on the way in (and stays
    # forever on an empty board).  Suppressing it is one property write; swapping
    # the whole preset for rushRanking() is an S4 decision.
    "findproperty " + QN % "partyList",
    "getproperty " + QN % "partyList",
    "pushtrue",
    "setproperty " + QN % "preventsShowEmptyStatePlaceholder",
    "pushnull",
    'astype QName(PackageNamespace("pinball.context.input"),"HookDispatcher")',
    "setlocal3",
    # Fire once per scene.  The adapter's baseArray *is* allPartyListData, so a
    # non-empty array means the response already landed and re-entering
    # afterTransition (returning from a sub-scene) must not append it twice.
    "findproperty " + QN % "allPartyListData",
    "getproperty " + QN % "allPartyListData",
    "getproperty " + QN % "length",
    "convert_i",
    "pushbyte 0",
    "ifne ofsRankOldAfter",
    "findproperty " + QN % "serviceLauncher",
    "getproperty " + QN % "serviceLauncher",
    'coerce QName(PackageNamespace("pinball.dialog.processing"),"ServiceLauncher")',
    "setlocal1",
    "findproperty " + QN % "gear",
    "getproperty " + QN % "gear",
    'coerce QName(PackageNamespace("jp.sipo.gipo.core"),"Gear")',
    "setlocal2",
    "getlocal1",
    "getproperty " + QN % "hookDispatcherProvider",
    "callproperty " + QN % "isAlive" + ", 0",
    "convert_b",
    "iffalse ofsRankOldAfter",
    "getlocal1",
    "getproperty " + QN % "hookDispatcherProvider",
    "findproperty " + QN % "copyPlayedParty",
    "getproperty " + QN % "copyPlayedParty",
    "coerce " + FUNCTION,
    'getlex QName(PackageNamespace("pinball.context"),"SectionCommand")',
    "getproperty " + QN % "ToolAgreementRemote",
    "coerce " + FUNCTION,
    "callproperty " + QN % "createHookDispatcher" + ", 2",
    'coerce QName(PackageNamespace("pinball.context.input"),"HookDispatcher")',
    "setlocal3",
    "getlocal2",
    "getlocal3",
    "pushstring " + _lit("fileName"),
    "pushstring " + _lit("pinball/dialog/processing/ServiceLauncher.hx"),
    "pushstring " + _lit("lineNumber"),
    "pushbyte 36",
    "pushstring " + _lit("className"),
    "pushstring " + _lit("pinball.dialog.processing.ServiceLauncher"),
    "pushstring " + _lit("methodName"),
    "pushstring " + _lit("startService"),
    "newobject 4",
    "callpropvoid " + QN % "addChild" + ", 2",
    "findproperty " + QN % "remote",
    "getproperty " + QN % "remote",
    "getlocal3",
    'callpropvoid QName(Namespace("pinball.context.remote:RemoteForLogic"),"toolAgreement"), 1',
    "ofsRankOldAfter:",
]
AFTER_TRANSITION_MAXSTACK = 10
AFTER_TRANSITION_LOCALCOUNT = 4

# ------------------------------------------------- C1: copyPlayedParty -------

# `param1` is the SectionCommand-shaped `ToolAgreementRemoteInput`; params[0] is
# the raw server `data` object (surgery C2 stops it from being repacked).
COPY_PLAYED_PARTY_HEAD = [
    "getlocal1",
    "getproperty " + QN % "params",
    "pushbyte 0",
    "getproperty " + MN_INDEX,
    "getproperty " + QN % "rows",
    "coerce_a",
    "setlocal2",
    "getlocal2",
    "pushnull",
    "ifeq ofsRankCopyDone",
    # The adapter's append() pushes into allPartyListData *and* notifies the
    # logic, which is what wires up each cell's select button.
    "findproperty " + QN % "partyList",
    "getproperty " + QN % "partyList",
    "getproperty " + QN % "abstractAdapter",
    "coerce_a",
    "getlocal2",
    "callpropvoid " + QN % "appendAll" + ", 1",
    # The view snapshots its page when the list was still empty, so it needs an
    # explicit nudge.  `viewSceneOrder` is an interface-typed field whose real
    # object is the scene view - astype guards the headless Empty*ViewOrder.
    "findproperty " + QN % "viewSceneOrder",
    "getproperty " + QN % "viewSceneOrder",
    "astype " + PARTY_VIEW,
    "coerce_a",
    "setlocal3",
    "getlocal3",
    "pushnull",
    "ifeq ofsRankCopyDone",
    "getlocal3",
    "getproperty " + QN % "partyListView",
    "callpropvoid " + QN % "reload" + ", 0",
    "ofsRankCopyDone:",
    "returnvoid",
    "ofsRankOldCopy:",
]

# s4: stash the page the viewer's own row sits on.  `allPartyListData` is an
# `Array`, which is a dynamic class in AS3, so a property nothing declared is a
# legal dynamic write; `page` is already in the constant pool as
# QName(PackageNamespace(""),"page"), so this costs no new multiname.  Server
# side is `RushNativeRankPayload.page` (see NATIVE_PAGE_SIZE).
COPY_PLAYED_PARTY_PAGE = [
    "findproperty " + QN % "allPartyListData",
    "getproperty " + QN % "allPartyListData",
    "getlocal1",
    "getproperty " + QN % "params",
    "pushbyte 0",
    "getproperty " + MN_INDEX,
    "getproperty " + QN % "page",
    "convert_i",
    "setproperty " + QN % "page",
]


def _payload(field: str) -> list[str]:
    """`param1.params[0].<field>` - one key off the raw server `data` object."""
    return [_gl(L_ARG1),
            "getproperty " + QN % "params",
            "pushbyte 0",
            "getproperty " + MN_INDEX,
            "getproperty " + QN % field]


# S5's own stash + the two front-of-screen widgets it fills.
#
# `allPartyListData` is an `Array` (a dynamic class in AS3), so the scene can
# hang extra properties on it; every name used here is already a
# QName(PackageNamespace(""), ...) in the P2 pool, so no multiname is added:
#
#     .page  -> the page the viewer's row is on          (S4)
#     .row   -> the row index inside that page, -1 = none (S5)
#     .list  -> the row array, so buttonClicked can map a row id to a player
#     .b     -> the top black bar container                (built in View/run)
#     .c     -> the pinned self-rank card container        (built in View/run)
COPY_PLAYED_PARTY_S5 = (
    ["findproperty " + QN % "allPartyListData",
     "getproperty " + QN % "allPartyListData"]
    + _payload("row")
    + ["convert_i",
       "setproperty " + QN % "row",
       "findproperty " + QN % "allPartyListData",
       "getproperty " + QN % "allPartyListData",
       _gl(L_ARG2),                        # local 2 still holds data.rows
       "setproperty " + QN % "list",
       # ---- top black bar ----
       "findproperty " + QN % "allPartyListData",
       "getproperty " + QN % "allPartyListData",
       "getproperty " + QN % "b",
       "coerce_a",
       _sl(4),
       _gl(4),
       "pushnull",
       "ifeq ofsRankS5Card",
       _gl(4),
       "pushstring " + _lit("text"),
       "callproperty " + QN % "getText" + ", 1"]
    + _payload("time")
    + ["callpropvoid " + QN % "set_text" + ", 1",
       "ofsRankS5Card:",
       # ---- pinned self-rank card ----
       "findproperty " + QN % "allPartyListData",
       "getproperty " + QN % "allPartyListData",
       "getproperty " + QN % "c",
       "coerce_a",
       _sl(4),
       _gl(4),
       "pushnull",
       "ifeq ofsRankS5CardDone"]
    + _payload("item")
    + ["coerce_a",
       _sl(5),
       _gl(5),
       "pushnull",
       "ifeq ofsRankS5CardDone"]
)


# ---- s5b: the top black bar and nothing else --------------------------------
#
# Same stash mechanism S4 already proved on the device (`allPartyListData.page`
# is an `Array` dynamic property written here and read back in
# `buttonClicked`), and the same `getText(<slot>).set_text(<string>)` call shape
# the cell renderer uses for every row.  Guarded on `.b` so the order between
# `View/run` and the response handler cannot matter.
COPY_PLAYED_PARTY_S5B = (
    ["findproperty " + QN % "allPartyListData",
     "getproperty " + QN % "allPartyListData",
     "getproperty " + QN % "b",
     "coerce_a",
     _sl(4),
     _gl(4),
     "pushnull",
     "ifeq ofsRankS5bBarDone",
     _gl(4),
     "pushstring " + _lit("text"),
     "callproperty " + QN % "getText" + ", 1"]
    + _payload("time")
    + ["callpropvoid " + QN % "set_text" + ", 1",
       "ofsRankS5bBarDone:"]
)

COPY_PLAYED_PARTY_S5B_LOCALCOUNT = 5


def _card_fill() -> list[str]:
    """Write the five text slots + the black rank flag onto the pinned card."""
    out: list[str] = []
    for slot, field in TEXT_SLOTS:
        out += [_gl(4),
                "pushstring " + _lit(slot),
                "callproperty " + QN % "getText" + ", 1",
                _gl(5),
                "getproperty " + QN % field,
                "callpropvoid " + QN % "set_text" + ", 1"]
    out += [_gl(4),
            "pushstring " + _lit(RANK_FLAG_IMAGE),
            "callproperty " + QN % "getImage" + ", 1",
            _gl(5),
            "getproperty " + QN % "visible",
            "setproperty " + QN % "visible",
            # built hidden in View/run so an empty black flag does not flash
            # while the request is in flight
            _gl(4),
            "pushtrue",
            "setproperty " + QN % "visible",
            "ofsRankS5CardDone:"]
    return out


def copy_played_party_block(variant: str) -> list[str]:
    predicate = _predicate(variant, "ofsRankOldCopy", MODE_FROM_SCENE)
    body = list(COPY_PLAYED_PARTY_HEAD)
    if variant in ("s4", "s5", "s5b"):
        # after appendAll / before the view reload, so a failure to reload does
        # not lose the page number
        at = body.index("findproperty " + QN % "viewSceneOrder")
        extra = list(COPY_PLAYED_PARTY_PAGE)
        if variant == "s5":
            extra += COPY_PLAYED_PARTY_S5 + _card_fill()
        elif variant == "s5b":
            extra += COPY_PLAYED_PARTY_S5B
        body = body[:at] + extra + body[at:]
    return predicate + body


COPY_PLAYED_PARTY_LOCALCOUNT = 6

# ------------------------------------------------- C2: successHandler --------

# The stock handler repacks the response into a 4-field object, which drops
# every key P4 needs.  Passing `_loc2_` (= param1.rawData.data) straight through
# keeps `terms_text` reachable for the P2 package and the rich-text link
# resolver, and makes the P4 keys reachable too.  Net: nine instructions removed.
SUCCESS_HANDLER_ANCHOR = [
    "pushstring " + _lit("required_privacy_version"),
    "getlocal 4",
    "pushstring " + _lit("required_terms_version"),
    "getlocal 6",
    "pushstring " + _lit("terms_text"),
    "getlocal 7",
    'coerce QName(PackageNamespace(""),"String")',
    "pushstring " + _lit("terms_url"),
    "getlocal 9",
    "newobject 4",
]
SUCCESS_HANDLER_REPLACEMENT = ["getlocal2"]

# ------------------------------------------------------------- A1: run() ----

RUN_REPLACEMENTS = [
    ("pushstring " + _lit("scene/rush/rush_event_ranking_party"),
     "pushstring " + _lit("scene/rush/rush_event_ranking")),
    ("pushstring " + _lit("layout/party_list_cell"),
     "pushstring " + _lit("layout/list_cell")),
]


# ---------------------------------------- D1: the crown button's destination --

# What P2 put in `RushEventTopScene.buttonClicked` case 5.
CROWN_ANCHOR = [
    "findproperty " + QN % "changeSceneWithLoading",
    "getlex " + LOADING_KIND,
    "getproperty " + QN % "TermsOfService",
    "getlex " + BACK_KIND,
    "getproperty " + QN % "AddCurrent",
    "callpropvoid " + QN % "changeSceneWithLoading" + ", 2",
]

# ... and what it becomes: the native ranking scene, entered with the sentinel.
#
# Shape copied from the live sibling `buttonClicked` case 4 (which builds
# `SceneKind.RushEventLoading(SceneKind.RushEventQuestSelect(...))` the same
# way) and from `RushEventQuestSelectScene.as:461`, the only real entry point of
# this scene kind.
#
# `AddCurrent` pushes the *current* scene kind - RushEventTop(eventId) - onto
# `logicStatus.backSceneKinds`, so the ranking scene kind (the one carrying the
# sentinel enum) never has to survive a TypePacker round trip on the way in.
# It still can get there later (the header's stone-buy flow pushes
# `stoneBuyDialogChangeSceneBackKind`), which is why the sentinel had to be a
# value the packer already accepts: map 188 declares
# `RushBattle(RushEventQuestFolderId)`, and `RushEventQuestFolderId` is
# registered as `TypeInformation.ABSTRACT("Int")`, so -1 simplifies to the plain
# int -1 with no master lookup and no range check.
#
# The first instruction is kept **verbatim** on purpose: it is the target of the
# sixth case of this method's `lookupswitch`, and re-pointing a branch is exactly
# the accident `verify_rank_p4._check_branch_targets` exists to catch.  It still
# does the right thing - `findproperty` pushes the scope object that owns the
# name, which for either of these two methods is `this` (both are inherited from
# `LogicScene`), so calling `changeSceneWithDetail` on it is correct.
CROWN_REPLACEMENT = [
    "findproperty " + QN % "changeSceneWithLoading",
    "getlex " + NEXT_KIND,
    "getlex " + SCENE_KIND,
    "findproperty " + QN % "eventId",
    "getproperty " + QN % "eventId",
    "getlex " + MODE,
    "pushint -1",
    "callproperty " + QN % "RushBattle" + ", 1",
    "coerce " + MODE,
    "getlex " + OPTION,
    "getproperty " + QN % "None",
    "callproperty " + QN % "RushEventRankingParty" + ", 3",
    "coerce " + SCENE_KIND,
    "callproperty " + QN % "Scene" + ", 1",
    "coerce " + NEXT_KIND,
    "getlex " + BACK_KIND,
    "getproperty " + QN % "AddCurrent",
    "callpropvoid " + QN % "changeSceneWithDetail" + ", 2",
]

# ------------------------------------------------- E1: the pager (Scene/run) --

# The assignment has to land between `partyList = new ...` and
# `gear.addChild(partyList, ...)`: gipo runs a child's run handler inside
# addChild, and `VerticalListLogic.baseRun` is where `pagerConfig` is read to
# decide whether the pager's own two button ids (33554432 / 50331648) go into
# `innerButtonGroup`.  Set it afterwards and `VerticalListPagerView.run` asks
# for a button that was never registered -> ClientError 7504.
# Every official caller does it in this order too (ReceiveHistoryScene.as:72-77,
# MailListScene.as:186-193).
SCENE_RUN_ANCHOR = ["initproperty " + QN % "partyList"]

# `VerticalListView.setupPager` switches on the *logic's* pagerConfig, so this
# one assignment is what makes the official "1 / N" pager appear at all.  It
# also drives `abstractAdapter.limitPerPage`, i.e. it is what stops the view
# from turning every row of the board into a live cell.
SCENE_RUN_PAGER = [
    "findproperty " + QN % "partyList",
    "getproperty " + QN % "partyList",
    "getlex " + PAGER_CONFIG,
    "pushint %d" % PAGE_SIZE,
    "callproperty " + QN % "Set" + ", 1",
    "setproperty " + QN % "pagerConfig",
]


def scene_run_block() -> list[str]:
    return (sentinel_guard("ofsRankRunDone", MODE_FROM_SCENE)
            + SCENE_RUN_PAGER
            + ["ofsRankRunDone:"])


# ----------------------------------------- E4: the two round buttons' clicks --

def _my_rank_branch(variant: str) -> list[str]:
    """「自身名次」: jump to the viewer's page, and on s5 scroll to the row.

    `page` alone is a no-op while the board fits on one page, which is why the
    author saw the button "do nothing".  `row` (0-based inside the page, -1 when
    the viewer is not on the board) is what makes it move; `scrollTo` is the
    list view's own API (`VerticalListView.as:430`).
    """
    jump = ["findproperty " + QN % "partyList",
            "getproperty " + QN % "partyList",
            "findproperty " + QN % "allPartyListData",
            "getproperty " + QN % "allPartyListData",
            "getproperty " + QN % "page",
            "convert_i",
            "callpropvoid " + QN % "changePage" + ", 1"]
    if variant != "s5":
        return jump + ["returnvoid"]
    return jump + [
        "findproperty " + QN % "allPartyListData",
        "getproperty " + QN % "allPartyListData",
        "getproperty " + QN % "row",
        "convert_i",
        _sl(L_ARG2),
        _gl(L_ARG2),
        "pushbyte 0",
        "iflt ofsRankBtnEnd",             # -1 = not on the board: do nothing
        "findproperty " + QN % "viewSceneOrder",
        "getproperty " + QN % "viewSceneOrder",
        "astype " + PARTY_VIEW,           # guards the headless Empty*ViewOrder
        "coerce_a",
        _sl(L_TMP_A),
        _gl(L_TMP_A),
        "pushnull",
        "ifeq ofsRankBtnEnd",
        _gl(L_TMP_A),
        "getproperty " + QN % "partyListView",
        "pushbyte 0",
        _gl(L_ARG2),
        "pushint %d" % CELL_PITCH,
        "multiply",
        "callpropvoid " + QN % "scrollTo" + ", 2",
        "returnvoid",
    ]


def _row_click_branch() -> list[str]:
    """S5: tapping a row opens that player's profile.

    id -> global row index -> `allPartyListData.list[i].id` -> the loading task
    `LoadingTaskKind.ProfileGetProfile(Number)` (index 23, resolved by
    `LogicScene.as:2294`), which posts `profile/get_profile` and lands on
    `SceneKind.PlayerProfile(ProfileKind.Other(...))`.  Both of those classes
    are alive in CN; the whole chain is stock code.

    `row.id == 0` means "this save is gone, there is no profile to show" - the
    server sends 0 for it, and this bails out rather than walking into a 404.
    """
    return [_gl(L_ARG1),
            "pushbyte %d" % ROW_BTN_BASE,
            "iflt ofsRankBtnEnd",
            _gl(L_ARG1),
            "pushbyte %d" % ROW_BTN_LIMIT,
            "ifge ofsRankBtnEnd",
            # global index = currentPageIndex * PAGE_SIZE + (id - ROW_BTN_BASE)
            "findproperty " + QN % "partyList",
            "getproperty " + QN % "partyList",
            "getproperty " + QN % "currentPageIndex",
            "convert_i",
            "pushint %d" % PAGE_SIZE,
            "multiply",
            _gl(L_ARG1),
            "pushbyte %d" % ROW_BTN_BASE,
            "subtract",
            "add",
            "convert_i",
            _sl(L_ARG2),
            "findproperty " + QN % "allPartyListData",
            "getproperty " + QN % "allPartyListData",
            "getproperty " + QN % "list",
            "coerce_a",
            _sl(L_TMP_A),
            _gl(L_TMP_A),
            "pushnull",
            "ifeq ofsRankBtnEnd",
            _gl(L_TMP_A),
            _gl(L_ARG2),
            "getproperty " + MN_INDEX,
            "coerce_a",
            _sl(L_TMP_A),
            _gl(L_TMP_A),
            "pushnull",
            "ifeq ofsRankBtnEnd",
            _gl(L_TMP_A),
            "getproperty " + QN % "id",
            # convert_**d**, not convert_i: the id is `9e9 + player_id`, which is
            # bigger than 2^31 - ToInt32 would wrap it (9000000008 -> 410065416).
            # It happens to stay positive for every id the server can send, but
            # relying on that is a footgun the day the base changes.
            "convert_d",
            "pushbyte 0",
            "ifle ofsRankBtnEnd",
            "findproperty " + QN % "changeSceneWithLoading",
            "getlex " + LOADING_KIND,
            _gl(L_TMP_A),
            "getproperty " + QN % "id",
            "convert_d",
            "callproperty " + QN % "ProfileGetProfile" + ", 1",
            "coerce " + LOADING_KIND,
            "getlex " + BACK_KIND,
            "getproperty " + QN % "AddCurrent",
            "callpropvoid " + QN % "changeSceneWithLoading" + ", 2",
            "returnvoid"]


def scene_button_clicked_block(variant: str = "s4") -> list[str]:
    """Intercept the ranking path's button ids before the stock row lookup.

    The stock body resolves `param1 & 0xFFFFFF` against `allPartyListData` and
    *throws* when there is no such row, so these ids must never reach it.
    Unknown ids on the ranking path fall to `returnvoid` instead.
    """
    tail = ["ofsRankBtnEnd:", "returnvoid", "ofsRankBtnOld:"]
    reward_escape = "ofsRankBtnRow" if variant == "s5" else "ofsRankBtnEnd"
    row = (["returnvoid", "ofsRankBtnRow:"] + _row_click_branch()) if variant == "s5" else []
    return (sentinel_guard("ofsRankBtnOld", MODE_FROM_SCENE)
            + [_gl(L_ARG1),
               "pushbyte %d" % BTN_MY_RANK,
               "ifne ofsRankBtnReward"]
            + _my_rank_branch(variant)
            + ["ofsRankBtnReward:",
               _gl(L_ARG1),
               "pushbyte %d" % BTN_REWARD,
               "ifne " + reward_escape]
            # The reward tiers already exist as a rendered page: P2's rich-text
            # screen (LoadingTaskKind.TermsOfService -> SceneKind.RichTextData)
            # lists them under both boards - and from S5 the server puts the
            # custom degree's plate image on it.  Reusing it costs six
            # instructions and keeps that whole branch alive.
            + CROWN_ANCHOR
            + row
            + tail)


# --------------------------------------- E2: preset swap + the round buttons --

VIEW_RUN_LIST_ANCHOR = ["initproperty " + QN % "partyListView"]

# Swap the whole view config *before* the list view is added as a gear child -
# `basePrepare` / `baseRun` (which is where `setupPager` and the empty-state
# placeholder get built) only run at `gear.addChild`.
#
# `pagerConfig` (the view's own copy: marginTop + position) is derived in the
# constructor from `config.pager`, so it has to be re-derived by hand here;
# `rushRanking()` declares `pager: Option.Some({...})`, hence `.params[0]`.
VIEW_RUN_PRESET = [
    "findproperty " + QN % "partyListView",
    "getproperty " + QN % "partyListView",
    "getlex " + PRESET,
    "callproperty " + QN % "rushRanking" + ", 0",
    "setproperty " + QN % "config",
    "findproperty " + QN % "partyListView",
    "getproperty " + QN % "partyListView",
    "findproperty " + QN % "partyListView",
    "getproperty " + QN % "partyListView",
    "getproperty " + QN % "config",
    "getproperty " + QN % "pager",
    "getproperty " + QN % "params",
    "pushbyte 0",
    "getproperty " + MN_INDEX,
    "setproperty " + QN % "pagerConfig",
]

L_TEMPLATE, L_BUTTON = 1, 2


def _round_button(button_id: int, config_name: str, right: bool) -> list[str]:
    """Build one `container/button`, place it, and register it.

    The container carries nothing but a 126x126 guide rectangle named `area`;
    every pixel of artwork (white circle, caption bitmap, icon) comes from the
    `ButtonConfig`, exactly as the official scenes do it.
    """
    if right:
        place_x = [_gl(L_BUTTON),
                   "findproperty " + QN % "safeArea",
                   "getproperty " + QN % "safeArea",
                   "getproperty " + QN % "x",
                   "findproperty " + QN % "safeArea",
                   "getproperty " + QN % "safeArea",
                   "getproperty " + QN % "width",
                   "add",
                   "pushbyte %d" % BTN_RIGHT_INSET,
                   "subtract",
                   "initproperty " + QN % "x"]
    else:
        place_x = [_gl(L_BUTTON),
                   "findproperty " + QN % "safeArea",
                   "getproperty " + QN % "safeArea",
                   "getproperty " + QN % "x",
                   "pushbyte %d" % BTN_LEFT_X,
                   "add",
                   "initproperty " + QN % "x"]
    return ([_gl(L_TEMPLATE),
             "getproperty " + QN % "uiProvider",
             "pushstring " + _lit("assetPath"),
             "pushstring " + _lit(RANK_ASSET_PATH),
             "pushstring " + _lit("name"),
             "pushstring " + _lit(RANK_BUTTON_LAYOUT),
             "newobject 2",
             "callproperty " + UI_PROVIDER_BUILD + ", 1",
             "coerce " + UI_CONTAINER,
             _sl(L_BUTTON)]
            + place_x
            + [_gl(L_BUTTON),
               "findproperty " + QN % "safeArea",
               "getproperty " + QN % "safeArea",
               "getproperty " + QN % "height",
               "pushint %d" % BTN_BOTTOM_INSET,
               "subtract",
               "initproperty " + QN % "y",
               # passContentLayer is added to the template's `layer` after the
               # list layer, so the buttons sit above the list rather than under
               # it, and it carries the same safeArea.y offset the list does.
               _gl(L_TEMPLATE),
               "getproperty " + QN % "passContentLayer",
               _gl(L_BUTTON),
               "callpropvoid " + QN % "addChild" + ", 1",
               "findproperty " + QN % "buttonGroupView",
               "getproperty " + QN % "buttonGroupView",
               "pushbyte %d" % button_id,
               _gl(L_BUTTON),
               _gl(L_BUTTON),
               "pushstring " + _lit("area"),
               "callproperty " + QN % "getGuideRectangle" + ", 1",
               "getlex " + BUTTON_CONFIGS,
               "getproperty " + QN % config_name,
               "callpropvoid " + QN % "addWithConfig" + ", 4"])


L_S5 = 3


def _safe_area(field: str) -> list[str]:
    return ["findproperty " + QN % "safeArea",
            "getproperty " + QN % "safeArea",
            "getproperty " + QN % field]


def _build_into(name: str) -> list[str]:
    """`uiProvider.build({assetPath: <ranking>, name: <name>})` -> local L_S5."""
    return [_gl(L_TEMPLATE),
            "getproperty " + QN % "uiProvider",
            "pushstring " + _lit("assetPath"),
            "pushstring " + _lit(RANK_ASSET_PATH),
            "pushstring " + _lit("name"),
            "pushstring " + _lit(name),
            "newobject 2",
            "callproperty " + UI_PROVIDER_BUILD + ", 1",
            "coerce " + UI_CONTAINER,
            _sl(L_S5)]


def _add_to_pass_layer() -> list[str]:
    """passContentLayer already carries the safeArea.y offset (see _round_button)."""
    return [_gl(L_TEMPLATE),
            "getproperty " + QN % "passContentLayer",
            _gl(L_S5),
            "callpropvoid " + QN % "addChild" + ", 1"]


def _stash_on_data(field: str) -> list[str]:
    """Hang the widget on the scene's `allPartyListData` so the response
    handler (`copyPlayedParty`) can find it again without a new class field."""
    return ["findproperty " + QN % "peek",
            "getproperty " + QN % "peek",
            "getproperty " + QN % "allPartyListData",
            _gl(L_S5),
            "setproperty " + QN % field]


def view_run_s5_block() -> list[str]:
    """S5's three front-of-screen pieces: list rect, top bar, pinned card."""
    return (sentinel_guard("ofsRankS5Done", MODE_FROM_VIEW_PEEK)
            # ---- 1. move + shrink the list to the official ranking_layer rect
            + [_gl(L_TEMPLATE),
               "getproperty " + QN % "listLayer"]
            + _safe_area("y")
            + ["pushint %d" % RANKING_LAYER_Y,
               "add",
               "setproperty " + QN % "y",
               # shrink by the same 438 - moving alone would push the bottom of
               # the list out of its own mask.  Deliberately **not**
               # `MenuSceneTemplateView.adjustList`: `getListSize` ends with
               # `safeArea.height -= ...` (MenuSceneTemplateView.as:277-278),
               # i.e. it *mutates* the template's safeArea, so a second call
               # would subtract the footer/pager allowance twice and leave the
               # list ~272 px too short.  `VerticalListView.resizeHeight`
               # (:463) is the single-purpose knob: `_resizeHeight` + a relayout.
               "findproperty " + QN % "partyListView",
               "getproperty " + QN % "partyListView",
               "findproperty " + QN % "partyListView",
               "getproperty " + QN % "partyListView",
               "getproperty " + QN % "listSize",
               "getproperty " + QN % "height",
               "pushint %d" % RANKING_LAYER_Y,
               "subtract",
               "callpropvoid " + QN % "resizeHeight" + ", 1"]
            # ---- 2. the top 「YYYY.MM.DD HH:MM更新」 black bar
            + _build_into(RANK_TIME_LAYOUT)
            + [_gl(L_S5)]
            + _safe_area("x")
            + ["pushint %d" % TIME_BAR_X,
               "add",
               "initproperty " + QN % "x",
               _gl(L_S5),
               "pushbyte %d" % TIME_BAR_Y,
               "initproperty " + QN % "y"]
            + _add_to_pass_layer()
            + _stash_on_data("b")
            # ---- 3. the light plate the pinned card sits on.  List cells get
            #        theirs from VerticalListCellViewBase; a standalone layout
            #        instance has none, so without this the card would sit
            #        straight on the page's `coloreaeaea` grey.
            + [_gl(L_TEMPLATE),
               "getproperty " + QN % "view",
               "getproperty " + QN % "asset",
               "pushstring " + _lit(RANK_CARD_PLATE),
               "callproperty " + QN % "getImage" + ", 1",
               "coerce_a",
               _sl(L_S5),
               _gl(L_S5)]
            + _safe_area("x")
            + ["pushbyte %d" % CARD_LEFT,
               "add",
               "setproperty " + QN % "x",
               _gl(L_S5),
               "pushint %d" % CARD_Y,
               "setproperty " + QN % "y",
               _gl(L_S5)]
            + _safe_area("width")
            + ["pushbyte %d" % CARD_LEFT,
               "subtract",
               "pushbyte %d" % CARD_LEFT,
               "subtract",
               "setproperty " + QN % "width",
               _gl(L_S5),
               "pushint %d" % RANK_CELL_HEIGHT,
               "setproperty " + QN % "height"]
            + _add_to_pass_layer()
            # ---- 4. the pinned self-rank card itself
            + _build_into(RANK_CELL_LAYOUT)
            + [_gl(L_S5)]
            + _safe_area("x")
            + ["pushbyte %d" % CARD_LEFT,
               "add",
               "initproperty " + QN % "x",
               _gl(L_S5),
               "pushint %d" % CARD_Y,
               "initproperty " + QN % "y",
               # the three 144x188 dummy slots stay hidden: the async texture
               # machinery lives in the cell class, and the bare backplates
               # would just be three dark checkerboard boxes.
               _gl(L_S5),
               "pushstring " + _lit(THUMBS_CONTAINER),
               "callproperty " + QN % "getContainer" + ", 1",
               "pushfalse",
               "setproperty " + QN % "visible",
               # hidden until the response lands, so an empty black rank flag
               # does not flash on the way in
               _gl(L_S5),
               "pushfalse",
               "setproperty " + QN % "visible"]
            + _add_to_pass_layer()
            + _stash_on_data("c")
            + ["ofsRankS5Done:"])


# ------------------------------------------------------------------ s5b -----
#
# Why s5b exists: P5 (= variant s5) black-screened on the device - the scene
# opened, nothing was drawn, and logcat showed no VerifyError, no ClientError
# and no Error #1xxx, with `/crash` still at 44.  Everything s5 names was
# re-checked offline against the *decoded* CDN data
# (`scene/rush/rush_event_ranking.ui` and `scene/general/sprite_sheet.atlas`):
# `container/time_range_layer`, its `text` slot, `layout/list_cell`, its
# `party_thumbnails` container, `label-assets/top_event_period_label` and
# `bg-assets/colorfafafa` all exist, and the rect arithmetic is correct
# (pager guide height 80 + marginTop 52 + 192 = 324, so listSize.height is
# 1596 -> 1158 after the shrink, first row top 478).  So it is not a missing
# asset and not an off-by-N.
#
# What is left is that s5 is the only stage that *mutates already-working
# layout state from inside `run()`*:
#     template.listLayer.y += 438
#     partyListView.resizeHeight(...) -> refreshLayout() -> baseDraw(0)
# i.e. it re-enters the list's entire draw path in the middle of the view's run
# handler.  Nothing in the official build does that.
#
# s5b = S4 verbatim + exactly one feature (the top black bar), and it touches
# the list only through `config.listPadding.top`.  `config` is the object
# literal `VerticalListViewConfigPreset.rushRanking()` just returned (a fresh
# dict per call - VerticalListViewConfigPreset.as:49-69), so the write is local
# to this list, cannot throw and cannot re-enter anything: `layoutCells` (:602)
# and `baseEarlyUpdate` (:1234) read it on the next draw.
#
# The documented cost: padding is scrollable content, so once the rows are tall
# enough to scroll (>= 7 rows at 220 px pitch in a 1596 px viewport) the top row
# can slide under the bar.  That is a cosmetic wart, not a black screen.
LIST_TOP_PADDING = RANK_CELL_HEIGHT   # 204; already in the int constant pool


def view_run_s5b_block() -> list[str]:
    """s5b's single front-of-screen piece: the 「…更新」 black bar."""
    return (sentinel_guard("ofsRankS5bDone", MODE_FROM_VIEW_PEEK)
            # make room without touching the list rect: pure property write on
            # the preset object this same method installed a few lines earlier
            + ["findproperty " + QN % "partyListView",
               "getproperty " + QN % "partyListView",
               "getproperty " + QN % "config",
               "getproperty " + QN % "listPadding",
               "pushint %d" % LIST_TOP_PADDING,
               "setproperty " + QN % "top"]
            # the bar itself, built exactly the way S4 builds `container/button`
            + _build_into(RANK_TIME_LAYOUT)
            + [_gl(L_S5)]
            + _safe_area("x")
            + ["pushint %d" % TIME_BAR_X,
               "add",
               "initproperty " + QN % "x",
               _gl(L_S5),
               "pushbyte %d" % TIME_BAR_Y,
               "initproperty " + QN % "y"]
            + _add_to_pass_layer()
            + _stash_on_data("b")
            + ["ofsRankS5bDone:"])


# The stock body already declares 10, which covers S5's deepest expression
# (the `uiProvider.build({...})` object literal, 6 operands + receiver).
# Declared here so a drift in the baseline shows up as a build failure rather
# than as a runtime stack overflow.
VIEW_RUN_MAXSTACK_MIN = 9
VIEW_RUN_LOCALCOUNT = 4


def view_run_buttons_block() -> list[str]:
    return (sentinel_guard("ofsRankViewDone", MODE_FROM_VIEW_PEEK)
            + _round_button(BTN_MY_RANK, "raidMyRanking", right=False)
            + _round_button(BTN_REWARD, "rushReward", right=True)
            + ["ofsRankViewDone:"])


def view_run_preset_block() -> list[str]:
    return (sentinel_guard("ofsRankViewPreset", MODE_FROM_VIEW_PEEK)
            + VIEW_RUN_PRESET
            + ["ofsRankViewPreset:"])


# =============================================================== machinery ===

NL = chr(10)


def _indent(line: str) -> str:
    return line[: len(line) - len(line.lstrip())]


def _split(block: str) -> tuple[list[str], int, int]:
    """Return the block's lines plus the index range of its `code` section."""
    lines = block.splitlines()
    starts = [i for i, line in enumerate(lines) if line.strip() == "code"]
    ends = [i for i, line in enumerate(lines) if line.strip() == "end ; code"]
    if len(starts) != 1 or len(ends) != 1 or ends[0] < starts[0]:
        raise PatchError("expected exactly one code section, got %d/%d" % (len(starts), len(ends)))
    return lines, starts[0] + 1, ends[0]


def _find_run(lines: list[str], lo: int, hi: int, needle: list[str]) -> int:
    stripped = [line.strip() for line in lines]
    hits = [i for i in range(lo, hi - len(needle) + 1)
            if stripped[i: i + len(needle)] == needle]
    if len(hits) != 1:
        raise PatchError("expected exactly one occurrence of %r, found %d"
                         % (needle[0], len(hits)))
    return hits[0]


def _code_indent(lines: list[str], lo: int) -> str:
    for index in range(lo, len(lines)):
        text = lines[index].strip()
        if text and not text.endswith(":"):
            return _indent(lines[index])
    raise PatchError("no instruction found to sample indentation from")


def _label_indent(lines: list[str], lo: int, hi: int, code_indent: str) -> str:
    """FFDec puts labels at a shallower indent than instructions.

    Sampled from a real label in the same body when there is one, so a change in
    FFDec's formatting cannot silently produce a file it then rejects.  Bodies
    with no branches have no label to sample; the assembler tokenises lines, so
    matching the instruction indent is fine there.
    """
    for index in range(lo, hi):
        text = lines[index].strip()
        if text.endswith(":") and " " not in text:
            return _indent(lines[index])
    return code_indent


def _emit(instructions: list[str], code_indent: str, label_indent: str) -> list[str]:
    """Render an instruction/label list with FFDec's own indentation rules."""
    return [(label_indent if text.endswith(":") else code_indent) + text
            for text in instructions]


def _insert_before_return(block: str, instructions: list[str]) -> str:
    """Insert *instructions* immediately before the body's trailing `returnvoid`.

    Only valid when that `returnvoid` is the last instruction of the body; the
    caller must know it is not a shared branch target (this body has no branches
    at all, which the assembler would reject if it changed).
    """
    lines, lo, hi = _split(block)
    at = hi - 1
    while at > lo and not lines[at].strip():
        at -= 1
    if lines[at].strip() != "returnvoid":
        raise PatchError("the body does not end with returnvoid")
    indent = _code_indent(lines, lo)
    labels = _label_indent(lines, lo, hi, indent)
    return NL.join(lines[:at] + _emit(instructions, indent, labels) + lines[at:]) + NL


def _insert_prologue(block: str, instructions: list[str]) -> str:
    """Insert *instructions* right after the body's `getlocal0 / pushscope`."""
    lines, lo, hi = _split(block)
    at = _find_run(lines, lo, hi, ["getlocal0", "pushscope"])
    if at != lo:
        raise PatchError("the body does not open with getlocal0/pushscope")
    indent = _code_indent(lines, lo)
    labels = _label_indent(lines, lo, hi, indent)
    return "\n".join(lines[: at + 2] + _emit(instructions, indent, labels) + lines[at + 2:]) + "\n"


def _replace_run(block: str, needle: list[str], replacement: list[str]) -> str:
    lines, lo, hi = _split(block)
    at = _find_run(lines, lo, hi, needle)
    indent = _code_indent(lines, lo)
    labels = _label_indent(lines, lo, hi, indent)
    return "\n".join(lines[:at] + _emit(replacement, indent, labels) + lines[at + len(needle):]) + "\n"


def _set_header(block: str, field: str, value: int) -> str:
    pattern = re.compile(r"^(\s*)%s\s+\d+\s*$" % field, re.MULTILINE)
    if len(pattern.findall(block)) != 1:
        raise PatchError("expected exactly one %s line" % field)
    return pattern.sub(lambda m: "%s%s %d" % (m.group(1), field, value), block)


def _header(block: str, field: str) -> int:
    match = re.search(r"^\s*%s\s+(\d+)\s*$" % field, block, re.MULTILINE)
    if match is None:
        raise PatchError("no %s line" % field)
    return int(match.group(1))


def _assert_absent(method: str, block: str, tokens: list[str]) -> None:
    stripped = {line.strip() for line in block.splitlines()}
    for token in tokens:
        if token in stripped:
            raise PatchError("%s: baseline already contains %r; refusing to double-patch"
                             % (method, token))


# ------------------------------------------------------------- the patches --

def _patch_content_run(block: str, variant: str) -> str:
    if variant in ("s1", "s2"):
        for old, new in RUN_REPLACEMENTS:
            _assert_absent("run", block, [new])
            block = _replace_run(block, [old], [new])
        return block
    _assert_absent("run", block, ["ofsRankRunAsset:"])
    block = _replace_run(block, RUN_ASSET_ANCHOR, run_asset_replacement())
    block = _replace_run(block, RUN_NAME_ANCHOR, run_name_replacement())
    if _header(block, "maxstack") != 6:
        raise PatchError("content run maxstack drifted from 6")
    # the guard runs with up to five operands of the object literal already on
    # the stack, and it needs two of its own
    return _set_header(block, "maxstack", 7)


def _patch_content_apply(block: str, variant: str) -> str:
    _assert_absent("apply", block, ["ofsRankOldApply:", "ofsRankTexPhase:"])
    return _insert_prologue(block, apply_block(variant))


def _patch_content_resize(block: str, variant: str) -> str:
    _assert_absent("resizeWidth", block, ["ofsRankOldResize:"])
    return _insert_prologue(block, resize_width_block(variant))


def _patch_create_list_cell(block: str, variant: str) -> str:
    _assert_absent("createListCell", block, ["pushint %d" % RANK_CELL_HEIGHT])
    if _header(block, "maxstack") != 1:
        raise PatchError("createListCell maxstack drifted from 1")
    if variant in ("s1", "s2"):
        block = _replace_run(block, CREATE_CELL_ANCHOR, CREATE_CELL_REPLACEMENT)
        return _set_header(block, "maxstack", 3)
    # s3/s4: keep the stock construct/return verbatim and slip the (branching)
    # height write in between - a pure insert, no baseline line duplicated.
    block = _replace_run(
        block, CREATE_CELL_ANCHOR,
        CREATE_CELL_ANCHOR[:2] + CREATE_CELL_HEIGHT_BLOCK + CREATE_CELL_ANCHOR[2:])
    return _set_header(block, "maxstack", 4)


def _patch_preparation(block: str, variant: str) -> str:
    # No double-patch sentinel needed: the anchors disappear once patched, so a
    # second pass fails in _find_run with "found 0" rather than double-applying.
    block = _replace_run(block, PREPARATION_ANCHOR, preparation_replacement(variant))
    if variant == "s1":
        # three 6-field object literals: 12 stack slots per literal plus the two
        # already-built rows underneath, so 16 covers it with room to spare.
        block = _set_header(block, "maxstack", 16)
    if variant in ("s4", "s5", "s5b"):
        block = _replace_run(block, PREPARATION_IDS_ANCHOR,
                             preparation_ids_replacement(variant))
    return block


def _patch_after_transition(block: str, variant: str) -> str:
    _assert_absent("afterTransition", block, ["ofsRankOldAfter:"])
    block = _insert_prologue(block, after_transition_block(variant))
    block = _set_header(block, "maxstack", AFTER_TRANSITION_MAXSTACK)
    return _set_header(block, "localcount", AFTER_TRANSITION_LOCALCOUNT)


def _patch_copy_played_party(block: str, variant: str) -> str:
    _assert_absent("copyPlayedParty", block, ["ofsRankOldCopy:"])
    block = _insert_prologue(block, copy_played_party_block(variant))
    if variant == "s5" and _header(block, "localcount") < COPY_PLAYED_PARTY_LOCALCOUNT:
        raise PatchError("copyPlayedParty localcount %d < %d - S5 uses locals 4/5"
                         % (_header(block, "localcount"), COPY_PLAYED_PARTY_LOCALCOUNT))
    if variant == "s5b" and _header(block, "localcount") < COPY_PLAYED_PARTY_S5B_LOCALCOUNT:
        raise PatchError("copyPlayedParty localcount %d < %d - s5b uses local 4"
                         % (_header(block, "localcount"), COPY_PLAYED_PARTY_S5B_LOCALCOUNT))
    return block


def _patch_success_handler(block: str, variant: str) -> str:
    # Same as preparation: the ten-instruction anchor is gone after one pass.
    return _replace_run(block, SUCCESS_HANDLER_ANCHOR, SUCCESS_HANDLER_REPLACEMENT)


def _patch_crown_button(block: str, variant: str) -> str:
    # `changeSceneWithDetail` already appears in this body (case 4), so the
    # double-patch sentinel has to be something only the new block has
    _assert_absent("buttonClicked", block, ["getlex " + MODE])
    return _replace_run(block, CROWN_ANCHOR, CROWN_REPLACEMENT)


def _patch_scene_run(block: str, variant: str) -> str:
    _assert_absent("run", block, ["ofsRankRunDone:"])
    return _replace_run(block, SCENE_RUN_ANCHOR,
                        SCENE_RUN_ANCHOR + scene_run_block())


def _patch_scene_button_clicked(block: str, variant: str) -> str:
    _assert_absent("buttonClicked", block, ["ofsRankBtnOld:"])
    block = _insert_prologue(block, scene_button_clicked_block(variant))
    if _header(block, "maxstack") < 4:
        raise PatchError("buttonClicked maxstack drifted below 4")
    if variant == "s5" and _header(block, "localcount") < 4:
        raise PatchError("buttonClicked localcount < 4 - S5 uses locals 2/3")
    return block


def _patch_view_run(block: str, variant: str) -> str:
    _assert_absent("run", block, ["ofsRankViewDone:", "ofsRankViewPreset:"])
    # 1) swap the preset while the list view is still un-parented
    block = _replace_run(block, VIEW_RUN_LIST_ANCHOR,
                         VIEW_RUN_LIST_ANCHOR + view_run_preset_block())
    # 2) build the round buttons once the template has laid everything out.
    #    S5's own widgets go in the **same** insert, so the body keeps exactly
    #    two hunks (a second `_insert_before_return` would land adjacent to the
    #    first and difflib would merge them, breaking the declared hunk shape).
    tail = view_run_buttons_block()
    if variant == "s5":
        tail = tail + view_run_s5_block()
    elif variant == "s5b":
        tail = tail + view_run_s5b_block()
    block = _insert_before_return(block, tail)
    if variant not in ("s5", "s5b"):
        return _set_header(block, "localcount", 3)
    if _header(block, "maxstack") < VIEW_RUN_MAXSTACK_MIN:
        raise PatchError("View/run maxstack is %d, below the %d S5 needs"
                         % (_header(block, "maxstack"), VIEW_RUN_MAXSTACK_MIN))
    return _set_header(block, "localcount", VIEW_RUN_LOCALCOUNT)


PATCHERS = {
    (CONTENT, "run"): _patch_content_run,
    (CONTENT, "apply"): _patch_content_apply,
    (CONTENT, "resizeWidth"): _patch_content_resize,
    (LISTVIEW, "createListCell"): _patch_create_list_cell,
    (SCENE, "preparation"): _patch_preparation,
    (SCENE, "afterTransition"): _patch_after_transition,
    (SCENE, "copyPlayedParty"): _patch_copy_played_party,
    (SCENE, "run"): _patch_scene_run,
    (SCENE, "buttonClicked"): _patch_scene_button_clicked,
    (VIEW, "run"): _patch_view_run,
    (REMOTE, "successHandler"): _patch_success_handler,
    (TOPSCENE, "buttonClicked"): _patch_crown_button,
}

S1_METHODS = [(CONTENT, "run"), (CONTENT, "apply"), (CONTENT, "resizeWidth"),
              (LISTVIEW, "createListCell"), (SCENE, "preparation")]
S2_METHODS = S1_METHODS + [(SCENE, "afterTransition"), (SCENE, "copyPlayedParty"),
                           (REMOTE, "successHandler")]
S3_METHODS = S2_METHODS + [(TOPSCENE, "buttonClicked")]
S4_METHODS = S3_METHODS + [(SCENE, "run"), (SCENE, "buttonClicked"), (VIEW, "run")]
# S5 touches the same twelve methods as S4 - it adds blocks, not bodies.
S5_METHODS = list(S4_METHODS)

# s5b = S4's twelve bodies again; it adds one block, not a body.
S5B_METHODS = list(S4_METHODS)

_METHODS = {"s1": S1_METHODS, "s2": S2_METHODS, "s3": S3_METHODS,
            "s4": S4_METHODS, "s5": S5_METHODS, "s5b": S5B_METHODS}


def methods_for(variant: str) -> list[tuple[str, str]]:
    try:
        return list(_METHODS[variant])
    except KeyError:
        raise PatchError("unknown variant %r" % variant) from None


def new_strings_for(variant: str) -> list[str]:
    """Strings the patch is allowed to append to the constant pool."""
    strings = list(NEW_STRINGS_COMMON)
    if variant == "s1":
        for row in FAKE_ROWS:
            for value in row:
                if isinstance(value, str) and value not in strings:
                    strings.append(value)
    if variant in ("s4", "s5", "s5b"):
        # the only new string S4 needs: the guide rectangle inside
        # `container/button`.  Everything else it touches is already in the pool
        # (RANK_ASSET_PATH came in with S1, RANK_BUTTON_LAYOUT is used by the
        # official layout tables, "assetPath"/"name" by every uiProvider.build).
        # "area" is already in the pool (every guide-rectangle lookup in the
        # build uses it); `container/button` is not, because nothing in CN
        # builds that container any more.
        if RANK_BUTTON_LAYOUT not in strings:
            strings.append(RANK_BUTTON_LAYOUT)
    if variant in ("s5", "s5b"):
        # S5's only pool growth.  Everything else it names is already there:
        # `layout/list_cell` (S1 used it), `text`, `rank_label`,
        # `party_thumbnails`, and even
        # `scene/general/sprite_sheet/bg-assets/colorfafafa` - checked against
        # the S4 SWF's string pool before this block was written.
        if RANK_TIME_LAYOUT not in strings:
            strings.append(RANK_TIME_LAYOUT)
    return strings


def patch_block(class_name: str, trait_name: str, block: str, variant: str) -> str:
    """Apply the P4 surgery for one FFDec-exported method block.

    :param class_name: fully qualified class name.
    :param trait_name: the method trait's name.
    :param block: the ``trait method ... end ; method`` text FFDec exported.
    :param variant: ``"s1"``/``"s2"`` (unconditional) or ``"s3"``..``"s5"``
        (sentinel-gated; S4 adds the pager, the preset swap and the two round
        buttons; S5 adds the top time bar, the pinned self-rank card, the
        official list rect, scroll-to-my-row and per-row profile navigation).
    :returns: the patched block, newline terminated.
    :raises PatchError: on any anchor mismatch or double patch.
    """
    key = (class_name, trait_name)
    if key not in PATCHERS:
        raise PatchError("no patch for %s/%s" % (class_name, trait_name))
    patched = PATCHERS[key](block, variant)

    baseline_code = _split(block)[0]
    patched_code = _split(patched)[0]
    if len(patched_code) < len(baseline_code) and key != (REMOTE, "successHandler"):
        raise PatchError("%s/%s: the patch removed instructions" % (class_name, trait_name))
    return patched if patched.endswith("\n") else patched + "\n"
