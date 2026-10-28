"""Apply C26: 「持有裂罅」 option in the native 筛选 dialog of the weapon (equipment) list.

Run AFTER C25 (input = an SWF that already carries round2 + C23 + C25).

usage: python -B -X utf8 c26_apply.py --in <swf> --out <swf> [--report <json>]

What the player sees (equipment category of 武器一览 only; never in the 裂罅 category, never in
the party weapon-select scene that shares the dialog):
  the native 筛选 dialog grows by one row (+136 px) under the 属性 row; the row holds one wide white
  checkbox button 「持有裂罅」 (same art/config family as the native 名称 / 能力 buttons, 460x112 layout
  container from the dialog's own UI json).  Tap toggles the native checked cover; 重置 clears it;
  确定 applies it; the dialog re-opens with it checked while active.  When active the list shows only
  owned weapons for which saveData.weapon_rivens holds at least one revealed riven
  (record.weapon_id == OwnedEquipmentLogic.id, slots 16000001..16000999, same range as C4/C9).
  It combines (AND) with the native keyword / element filters and does not change the sort.

Mechanics (all single-method inserts, no new methods / traits):
  EquipmentListScene/buttonClicked            before `new EquipmentFilterDialog(filterSetting, ..)`:
                                              mark the equipment-mode filterSetting `c26Host = true`.
  EquipmentFilterDialog/prepare               core group kinds [0,1,2] gain 3 when initialSetting is a
                                              c26Host equipment setting; at the end re-check kind 3 when
                                              initialSetting.c26OwnRiven.
  EquipmentFilterDialog/dialogButtonClicked   prefix (kind 3 exists only in that case): 3 = toggle
                                              checked (core group is not a checkbox group); 2 (重置) =
                                              uncheck then native; 0 (确定) = initialSetting.c26Pending
                                              = checked, then native / C3 (closeThen → okHandler).
  EquipmentFilterDialogContentView/run        tail: build container/button460x112 from
                                              scene/equipment_list/equipment_list_filter_dialog, place
                                              it at (508, 640) in layout, addWithConfig(3, Box white
                                              「持有裂罅」) on the core ButtonGroupView (like 重置).
  EquipmentFilterDialogContentView/get_height +136 while kind 3 exists.
  EquipmentListScene/filterDialogOkHandler    (non-ResponseData path, before C9): move the pending
                                              flag of the current filterSetting onto the new setting as
                                              c26OwnRiven, clear the pending slot, and when only this
                                              flag changed set forcedSearchBySameSettingOnce (native
                                              equals() ignores it and would early-return).
  EquipmentListScene/rebuildAllThumbnails     is-origin := false while c26OwnRiven (so an empty result
                                              shows the native 'by filter' empty placeholder).
                                              (EquipmentFilterSettingTools.equals is not touched: its
                                              native dead `jump` to code end blocks any splice there.)
  EquipmentListScene/getFilteredEquipmentList before the final return: when c26OwnRiven, keep only ids
                                              present in the weapon_id set of saveData.weapon_rivens.
                                              (C3's async completion re-runs this method, so this is the
                                              single list source of the equipment category.)

Asserted on every run (same contract as c23_apply / c25_apply):
  no new methods / traits; structural tables identical; pools append-only; exactly the 8 methods
  change; each unsplices back to its input bytes; restoring them and truncating pools reproduces the
  input SWF byte for byte; anchors checked by instruction shape (C25 prefix present in buttonClicked);
  ActionEvaluator / NormalAttackCalculator / MemberImpl / AbilityDamageShot untouched; no admission
  strings; no numeric pool growth.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import c26_paths  # noqa: F401
from framework import Editor
from common import freeze
import asm
import bodies

TABLES = ('methods', 'instances', 'classes', 'scripts', 'metadata', 'namespaces', 'ns_sets')
POOLS = ('strings', 'ints', 'uints', 'doubles', 'multinames')
PROTECTED = ('ActionEvaluator', 'NormalAttackCalculator', 'MemberImpl', 'AbilityDamageShot')
DYN = 14                      # MultinameL used by the riven patches for o[key]
KIND = 3                      # new kind in the dialog's core ButtonGroupLogic (0 ok, 1 cancel, 2 reset)
LABEL = '持有裂罅'
ASSET = 'scene/equipment_list/equipment_list_filter_dialog'
CONTAINER = 'container/button460x112'
POS_X, POS_Y, GROW = 508, 640, 136
HOST, PENDING, FLAG = 'c26Host', 'c26Pending', 'c26OwnRiven'
FIRST_SLOT, LAST_SLOT = 16000001, 16000999
FILTER_DIALOG = 'pinball.dialog.equipmentFilter::EquipmentFilterDialog'

M_PREPARE = 'EquipmentFilterDialog/prepare'
M_CLICK = 'EquipmentFilterDialog/dialogButtonClicked'
M_RUN = 'EquipmentFilterDialogContentView/run'
M_HEIGHT = 'EquipmentFilterDialogContentView/get_height'
M_SCENE_CLICK = 'EquipmentListScene/buttonClicked'
M_OK = 'EquipmentListScene/filterDialogOkHandler'
M_REBUILD = 'EquipmentListScene/rebuildAllThumbnails'
M_LIST = 'EquipmentListScene/getFilteredEquipmentList'
M_ITEMS = 'ItemTableTranslator/translateFromCategorizedItems'
METHODS = (M_PREPARE, M_CLICK, M_RUN, M_HEIGHT, M_SCENE_CLICK, M_OK, M_REBUILD, M_LIST, M_ITEMS)
UNKNOWN, FRAGMENT, THEMED_LAST_OFFSET = 16000000, 16000900, 19      # themed = 16000901..16000919


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def body_bytes(body):
    return repr(body[:5]).encode() + body[5] + repr(body[6]).encode() + repr(
        [(t.name, t.kind, t.attr, t.data, t.metadata) for t in (body[7] if len(body) > 7 else [])]).encode()


class B:
    """Small emit helpers bound to one editor."""

    def __init__(self, e):
        self.e = e

    def g(self, n):
        return ('getlocal', n)

    def p(self, n):
        return ('setlocal', n)

    def gp(self, name):
        return ('getproperty', self.e.q(name))

    def dget(self, key):
        return [self.e.string(key), ('getproperty', DYN)]

    def n(self, value):
        return self.e.number(value)


# ---------------------------------------------------------------- anchors
def ops_of(e, label):
    return asm.decode(e.body(label)[5])


def mn(e, op):
    return e.abc.mn_name(op.args[0])


def anchor_prepare(e):
    ops = ops_of(e, M_PREPARE)
    # coreButtonGroup = bookChild(new ButtonGroupLogic(dialogButtonClicked, [0,1,2]))
    hits = [i for i, o in enumerate(ops) if o.name == 'constructprop' and mn(e, o) ==
            'pinball.ui.component.button::ButtonGroupLogic' and ops[i - 1].name == 'newarray'
            and ops[i - 1].args[0] == 3]
    assert len(hits) == 1, hits
    at = hits[0]
    assert [o.name for o in ops[at - 4:at - 1]] == ['pushbyte', 'pushbyte', 'pushbyte']
    assert [o.args[0] for o in ops[at - 4:at - 1]] == [0, 1, 2]
    assert ops[at - 6].name == 'getproperty' and mn(e, ops[at - 6]) == 'dialogButtonClicked'
    nxt = [i for i in range(at, len(ops)) if ops[i].name == 'initproperty']
    assert mn(e, ops[nxt[0]]) == 'coreButtonGroup'
    assert ops[-1].name == 'returnvoid'
    return at, len(ops) - 1


def anchor_click(e):
    ops = ops_of(e, M_CLICK)
    assert [o.name for o in ops[:2]] == ['getlocal_0', 'pushscope']
    # C3 riven prefix begins at 2 (initialSetting.wfxRiven)
    assert ops[2].name == 'getlocal_0' and mn(e, ops[3]) == 'initialSetting' and e.abc.s(ops[4].args[0]) == 'wfxRiven'
    return 2


def anchor_run(e):
    ops = ops_of(e, M_RUN)
    assert ops[-1].name == 'returnvoid'
    assert any(o.name == 'pushstring' and e.abc.s(o.args[0]) == 'select_reset_button' for o in ops)
    return len(ops) - 1


def anchor_height(e):
    ops = ops_of(e, M_HEIGHT)
    assert [o.name for o in ops[-3:]] == ['callproperty', 'convert_i', 'returnvalue'] and mn(e, ops[-3]) == 'round'
    return len(ops) - 1


def anchor_scene_click(e):
    ops = ops_of(e, M_SCENE_CLICK)
    # C25 prefix must be present (C26 runs after C25)
    assert ops[2].name == 'pushstring' and e.abc.s(ops[2].args[0]) == 'filterSetting', 'C25 prefix missing'
    assert any(o.name == 'pushstring' and e.abc.s(o.args[0]) == 'c25_workshop' for o in ops), 'C25 prefix missing'
    hits = [i for i, o in enumerate(ops) if o.name == 'constructprop' and mn(e, o) == FILTER_DIALOG]
    assert len(hits) == 1
    at = hits[0] - 7
    assert ops[at].name == 'findproperty' and mn(e, ops[at]) == 'openDialog'
    assert ops[at + 1].name == 'findpropstrict' and mn(e, ops[at + 1]) == FILTER_DIALOG
    assert ops[at - 1].name == 'ifne' and ops[at - 2].name == 'pushint' and e.abc.ints[ops[at - 2].args[0]] == 0x2000000
    return at


def anchor_ok(e):
    ops = ops_of(e, M_OK)
    # C23 prefix: getlocal_1; istype ResponseData; iffalse -> non-response path
    assert ops[2].name == 'getlocal_1' and ops[3].name == 'istype' and mn(e, ops[3]) == 'pinball.remote.common::ResponseData'
    assert ops[4].name == 'iffalse'
    at = ops[4].target
    # C9 preserve_filter starts there
    assert ops[at].name == 'getlocal_0' and mn(e, ops[at + 1]) == 'filterSetting'
    assert ops[at + 3].name == 'getlocal' and e.abc.s(ops[at + 4].args[0]) == 'wfxRivenWeaponId'
    assert ops[at - 1].name == 'returnvoid'
    return at


def anchor_rebuild(e):
    ops = ops_of(e, M_REBUILD)
    hits = [i for i, o in enumerate(ops) if o.name == 'callproperty' and mn(e, o) == 'equals']
    assert len(hits) == 1
    at = hits[0] + 4
    assert ops[hits[0] - 4].name == 'callproperty' and mn(e, ops[hits[0] - 4]) == 'getOrigin'
    assert [o.name for o in ops[hits[0] + 1:at]] == ['convert_b', 'convert_b', 'setlocal_1']
    return at


def anchor_list(e):
    ops = ops_of(e, M_LIST)
    assert [o.name for o in ops[-2:]] == ['getlocal', 'returnvalue'] and ops[-2].args[0] == 7
    loop = ops[-3]
    assert loop.name == 'iflt' and ops[loop.target - 1].name != 'returnvalue'
    assert ops[loop.target + 4].name == 'coerce' and mn(e, ops[loop.target + 4]) == 'pinball.common.data.item::OwnedEquipmentLogic'
    return len(ops) - 2


def anchor_items(e):
    """C3 regroup (round2 bound 16000000..16000999) has split category-5 rows into ordinary (local 20) and
    riven (local 21); insert right where it starts appending them (the iffalse-target `getlocal 21`
    after the ordinary append), so every path sees the reordered riven array."""
    ops = ops_of(e, M_ITEMS)
    hits = [i for i in range(len(ops) - 3) if ops[i].name == 'getlocal' and ops[i].args[0] == 21
            and ops[i + 1].name == 'getproperty' and mn(e, ops[i + 1]) == 'length' and ops[i + 2].name == 'iffalse'
            and ops[i + 3].name == 'getlocal' and ops[i + 3].args[0] == 13]
    assert len(hits) == 1, hits
    at = hits[0]
    assert ops[at - 13].name == 'getlocal' and ops[at - 13].args[0] == 20 and mn(e, ops[at - 12]) == 'length'
    lo = [i for i, o in enumerate(ops) if o.name == 'pushint' and e.abc.ints[o.args[0]] == 16000999]
    assert len(lo) == 1 and lo[0] < at                                 # round2 widened bound present
    ret = [i for i, o in enumerate(ops) if o.name == 'callproperty' and mn(e, o) == 'http://adobe.com/AS3/2006/builtin::indexOf']
    assert len(ret) == 1 and ret[0] > at                               # C8 group promotion after us
    return at


# ---------------------------------------------------------------- blocks
def host_gate(e, setting_src, s, fail):
    """Pass only for the equipment category of 武器一览 (setting marked c26Host, not wfxRiven).  Evaluated
    before any call on a button group, so the riven category / other hosts run exactly the old code."""
    b = B(e)
    return [*setting_src, ('coerce_a',), b.p(s), b.g(s), ('iffalse', fail),
            b.g(s), *b.dget('wfxRiven'), ('iftrue', fail),
            b.g(s), *b.dget(HOST), ('iffalse', fail)]


def blk_prepare_kinds(e, first):
    b = B(e)
    s = first
    return [('getlocal_0',), b.gp('initialSetting'), ('coerce_a',), b.p(s), b.g(s), ('iffalse', 'end'),
            b.g(s), *b.dget('wfxRiven'), ('iftrue', 'end'),
            b.g(s), *b.dget(HOST), ('iffalse', 'end'),
            ('dup',), b.n(KIND), ('callpropvoid', e.q('http://adobe.com/AS3/2006/builtin::push'), 1),
            ('label', 'end')]


def blk_prepare_check(e, first):
    b = B(e)
    grp, s = first, first + 1
    return [*host_gate(e, [('getlocal_0',), b.gp('initialSetting')], s, 'end'),
            b.g(s), *b.dget(FLAG), ('iffalse', 'end'),
            ('getlocal_0',), b.gp('coreButtonGroup'), ('coerce_a',), b.p(grp), b.g(grp), ('iffalse', 'end'),
            b.g(grp), b.n(KIND), ('callproperty', e.q('exists'), 1), ('iffalse', 'end'),
            b.g(grp), b.n(KIND), ('callproperty', e.q('get'), 1), ('pushtrue',), ('setproperty', e.q('checked')),
            ('label', 'end')]


def blk_click(e, first):
    b = B(e)
    grp, btn, s = first, first + 1, first + 2
    return [*host_gate(e, [('getlocal_0',), b.gp('initialSetting')], s, 'end'),
            ('getlocal_0',), b.gp('coreButtonGroup'), ('coerce_a',), b.p(grp), b.g(grp), ('iffalse', 'end'),
            b.g(grp), b.n(KIND), ('callproperty', e.q('exists'), 1), ('iffalse', 'end'),
            b.g(grp), b.n(KIND), ('callproperty', e.q('get'), 1), ('coerce_a',), b.p(btn),
            # 3: toggle (the core group is not a checkbox group, so the click does not toggle by itself)
            ('getlocal_1',), b.n(KIND), ('ifne', 'not_toggle'),
            b.g(btn), b.g(btn), b.gp('checked'), ('not',), ('setproperty', e.q('checked')), ('returnvoid',),
            # 2: 重置 also clears this box, then the native / C3 reset runs
            ('label', 'not_toggle'), ('getlocal_1',), b.n(2), ('ifne', 'not_reset'),
            b.g(btn), ('pushfalse',), ('setproperty', e.q('checked')), ('jump', 'end'),
            # 0: 确定 records the choice on the setting the dialog was opened with
            ('label', 'not_reset'), ('getlocal_1',), b.n(0), ('ifne', 'end'),
            b.g(s), e.string(PENDING), b.g(btn), b.gp('checked'), ('convert_b',), ('setproperty', DYN),
            ('label', 'end')]


def box_config(e):
    q = e.q
    return [('getlex', q('pinball.ui.component.button.config.core::ButtonConfig')),
            e.string('background'), e.string('parent'),
            ('getlex', q('pinball.ui.component.button.config.preset::ButtonBackgroundDefaultConfigs')),
            ('getproperty', q('boxPureWhiteColor')), ('newobject', 1),
            e.string('content'), e.string('parent'),
            ('getlex', q('pinball.ui.component.button.config.preset::ButtonContentDefaultConfigs')),
            ('getproperty', q('white')), e.string('text'), e.string(LABEL), ('newobject', 2),
            ('newobject', 2), ('callproperty', q('Box'), 1)]


def kind_exists(e, peek_src, grp, fail):
    b = B(e)
    return [*peek_src, ('coerce_a',), b.p(grp), b.g(grp), ('iffalse', fail),
            *host_gate(e, [b.g(grp), b.gp('initialSetting')], grp + 1, fail),
            b.g(grp), ('callproperty', e.q('getCoreButtonGroup'), 0), ('coerce_a',), b.p(grp), b.g(grp), ('iffalse', fail),
            b.g(grp), b.n(KIND), ('callproperty', e.q('exists'), 1), ('iffalse', fail)]


def blk_run(e, first):
    b = B(e)
    q = e.q
    grp, cont = first, first + 2
    code = kind_exists(e, [('getlocal_0',), b.gp('peek')], grp, 'end')
    code += [('getlocal_0',), b.gp('uiProvider'), e.string('assetPath'), e.string(ASSET),
             e.string('name'), e.string(CONTAINER), ('newobject', 2),
             ('callproperty', q('pinball.ui.provider:UiProvider::build'), 1),
             ('coerce', q('pinball.ui.display::UiDisplayObjectContainer')), b.p(cont),
             b.g(cont), b.n(POS_X), ('setproperty', q('x')),
             b.g(cont), b.n(POS_Y), ('setproperty', q('y')),
             ('getlocal_0',), b.gp('layout'), b.g(cont), ('callpropvoid', q('addChild'), 1),
             ('getlocal_0',), b.gp('coreButtonGroupView'), b.n(KIND), b.g(cont),
             b.g(cont), e.string('area'), ('pushnull',), ('callproperty', q('getGuideRectangle'), 2),
             *box_config(e), ('callpropvoid', q('addWithConfig'), 4),
             ('label', 'end')]
    return code


def blk_height(e, first):
    b = B(e)
    return [*kind_exists(e, [('getlocal_0',), b.gp('peek')], first, 'end'),
            b.n(GROW), ('add',), ('convert_i',), ('label', 'end')]


def blk_scene_click(e, first):
    b = B(e)
    s = first
    return [('getlocal_0',), b.gp('filterSetting'), ('coerce_a',), b.p(s), b.g(s), ('iffalse', 'end'),
            b.g(s), *b.dget('wfxRiven'), ('iftrue', 'end'),
            b.g(s), e.string(HOST), ('pushtrue',), ('setproperty', DYN), ('label', 'end')]


def blk_ok(e, first):
    b = B(e)
    s, pend = first, first + 1
    return [('getlocal_1',), ('iffalse', 'end'),
            ('getlocal_0',), b.gp('filterSetting'), ('coerce_a',), b.p(s), b.g(s), ('iffalse', 'end'),
            b.g(s), *b.dget(PENDING), ('coerce_a',), b.p(pend),
            b.g(pend), ('pushnull',), ('ifeq', 'end'),                 # absent / consumed (undefined == null)
            # only this box changed -> native equals() would early-return; force one search
            b.g(s), *b.dget(FLAG), ('convert_b',), b.g(pend), ('convert_b',), ('ifeq', 'same'),
            ('getlocal_0',), ('pushtrue',), ('setproperty', e.q('forcedSearchBySameSettingOnce')),
            ('label', 'same'),
            ('getlocal_1',), e.string(FLAG), b.g(pend), ('convert_b',), ('setproperty', DYN),
            b.g(s), e.string(PENDING), ('pushnull',), ('setproperty', DYN),
            ('label', 'end')]


def blk_rebuild(e, first):
    """is-origin (empty placeholder text) is false while c26OwnRiven is active."""
    b = B(e)
    s = first
    return [('getlocal_0',), b.gp('filterSetting'), ('coerce_a',), b.p(s), b.g(s), ('iffalse', 'end'),
            b.g(s), *b.dget(FLAG), ('iffalse', 'end'), ('pushfalse',), ('setlocal_1',), ('label', 'end')]


def blk_items(e, first):
    """Riven group row order: 未知裂罅 16000000, then themed 16000901..16000919 by id, then the rest in
    the existing order (revealed instances by display order / id, fragment 16000900 where it was)."""
    b = B(e)
    q = e.q
    out, i, row, ident, t, last = range(first, first + 6)
    push = ('callpropvoid', q('http://adobe.com/AS3/2006/builtin::push'), 1)

    def row_id(n):
        return [b.g(21), b.g(i), ('getproperty', DYN), ('coerce_a',), b.p(row),
                b.g(row), b.gp('kind'), b.gp('params'), b.n(0), ('getproperty', DYN), b.gp('itemId'),
                ('convert_i',), b.p(ident)]

    def scan(tag, body):
        return [b.n(0), b.p(i), ('label', tag + '_loop'), ('avm_label',),
                b.g(i), b.g(21), b.gp('length'), ('ifge', tag + '_done'),
                *row_id(tag), *body(tag), ('label', tag + '_next'), ('inclocal_i', i), ('jump', tag + '_loop'),
                ('label', tag + '_done')]

    code = [('newarray', 0), b.p(out),
            b.n(FRAGMENT), b.n(THEMED_LAST_OFFSET), ('add_i',), b.p(last)]
    code += scan('unk', lambda tag: [b.g(ident), b.n(UNKNOWN), ('ifne', tag + '_next'), b.g(out), b.g(row), push])
    code += [b.n(FRAGMENT), ('increment_i',), b.p(t),
             ('label', 'theme_loop'), ('avm_label',), b.g(t), b.g(last), ('ifgt', 'theme_done')]
    code += scan('thm', lambda tag: [b.g(ident), b.g(t), ('ifne', tag + '_next'), b.g(out), b.g(row), push])
    code += [('inclocal_i', t), ('jump', 'theme_loop'), ('label', 'theme_done')]
    code += scan('rest', lambda tag: [b.g(ident), b.n(UNKNOWN), ('ifeq', tag + '_next'),
                                      b.g(ident), b.n(FRAGMENT), ('ifle', tag + '_keep'),
                                      b.g(ident), b.g(last), ('ifle', tag + '_next'),
                                      ('label', tag + '_keep'), b.g(out), b.g(row), push])
    code += [b.g(out), b.p(21)]
    return code


def blk_list(e, first):
    b = B(e)
    q = e.q
    s, cards, have, i, rec, out, j, v = range(first, first + 8)
    code = [('getlocal_0',), b.gp('filterSetting'), ('coerce_a',), b.p(s), b.g(s), ('iffalse', 'end'),
            b.g(s), *b.dget(FLAG), ('iffalse', 'end'),
            ('pushnull',), b.p(cards),
            # primary: the scene's player (set in run, used by the native search right above)
            ('getlocal_0',), b.gp('player'), ('coerce_a',), b.p(rec), b.g(rec), ('iffalse', 'fallback'),
            b.g(rec), b.gp('saveData'), ('coerce_a',), b.p(rec), b.g(rec), ('iffalse', 'fallback'),
            b.g(rec), *b.dget('weapon_rivens'), ('coerce_a',), b.p(cards), b.g(cards), ('iftrue', 'collect'),
            # fallback: PinballClientMain.top.logic.globalLogic.logicStatus.getPlayerSaveData()
            ('label', 'fallback'),
            ('getlex', q('PinballClientMain')), b.gp('top'), ('coerce_a',), b.p(rec), b.g(rec), ('iffalse', 'collect')]
    for field in ('logic', 'globalLogic', 'logicStatus'):
        code += [b.g(rec), b.gp(field), ('coerce_a',), b.p(rec), b.g(rec), ('iffalse', 'collect')]
    code += [b.g(rec), ('callproperty', q('getPlayerSaveData'), 0), ('coerce_a',), b.p(rec), b.g(rec), ('iffalse', 'collect'),
             b.g(rec), *b.dget('weapon_rivens'), ('coerce_a',), b.p(cards),
             ('label', 'collect'),
             ('newobject', 0), b.p(have),
             b.g(cards), ('iffalse', 'filter'),
             b.n(FIRST_SLOT), b.p(i),
             ('label', 'slot_loop'), ('avm_label',),
             b.g(i), b.n(LAST_SLOT), ('ifgt', 'filter'),
             b.g(cards), b.g(i), ('getproperty', DYN), ('coerce_a',), b.p(rec),
             b.g(rec), ('iffalse', 'slot_next'),
             b.g(rec), *b.dget('weapon_id'), ('iffalse', 'slot_next'),
             b.g(have), b.g(rec), *b.dget('weapon_id'), ('pushtrue',), ('setproperty', DYN),
             ('label', 'slot_next'), ('inclocal_i', i), ('jump', 'slot_loop'),
             ('label', 'filter'),
             ('newarray', 0), b.p(out), b.n(0), b.p(j),
             ('label', 'id_loop'), ('avm_label',),
             b.g(j), ('getlocal', 7), b.gp('length'), ('ifge', 'id_done'),
             ('getlocal', 7), b.g(j), ('getproperty', DYN), ('coerce_a',), b.p(v),
             b.g(have), b.g(v), ('getproperty', DYN), ('iffalse', 'id_next'),
             b.g(out), b.g(v), ('callpropvoid', q('http://adobe.com/AS3/2006/builtin::push'), 1),
             ('label', 'id_next'), ('inclocal_i', j), ('jump', 'id_loop'),
             ('label', 'id_done'),
             b.g(out), ('coerce', q('Array')), ('setlocal', 7),
             ('label', 'end')]
    return code




def plan(e):
    at_kinds, at_end = anchor_prepare(e)
    return [
        (M_PREPARE, at_kinds, blk_prepare_kinds, asm.FORBID, 'core group kinds [0,1,2] + 3 for c26Host equipment settings'),
        (M_PREPARE, at_end, blk_prepare_check, asm.ENTER, 're-check kind 3 when initialSetting.c26OwnRiven'),
        (M_CLICK, anchor_click(e), blk_click, asm.FORBID, 'kind 3 toggle / reset clears / ok records c26Pending'),
        (M_RUN, anchor_run(e), blk_run, asm.ENTER, 'add 「持有裂罅」 460x112 white box button (kind 3) at (508,640)'),
        (M_HEIGHT, anchor_height(e), blk_height, asm.FORBID, 'content height +136 while kind 3 exists'),
        (M_SCENE_CLICK, anchor_scene_click(e), blk_scene_click, asm.FORBID, 'mark equipment filterSetting c26Host before opening the dialog'),
        (M_OK, anchor_ok(e), blk_ok, asm.ENTER, 'move c26Pending of current setting onto the new setting as c26OwnRiven'),
        (M_REBUILD, anchor_rebuild(e), blk_rebuild, asm.FORBID, 'is-origin false while c26OwnRiven (empty placeholder by filter)'),
        (M_LIST, anchor_list(e), blk_list, asm.FORBID, 'keep only ids with a revealed riven when c26OwnRiven'),
        (M_ITEMS, anchor_items(e), blk_items, asm.ENTER, '道具一览 riven group: unknown, themed 901..919 by id, then the rest'),
    ]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--report')
    a = ap.parse_args(argv)
    src, out = Path(a.src), Path(a.out)
    assert src.resolve() != out.resolve()
    raw_in = src.read_bytes()
    e = Editor(src, {})
    originals = {n: copy.deepcopy(getattr(e.abc, n)) for n in (*TABLES, *POOLS)}
    rows = []
    for label, at, builder, incoming, note in plan(e):
        body = e.body(label)
        e.locks.setdefault(label, {'sha': sha(body[5]), 'header': list(body[1:5])})
        first = body[2]
        block = asm.assemble(builder(e, first))
        e.insertions.setdefault(label, []).append((at, block, incoming))
        rows.append({'method': label, 'at': at, 'instructions': len(block), 'incoming': incoming,
                     'first_local': first, 'method_sha256_before': sha(body[5]), 'note': note})
    e.apply()
    assert not e.new_methods and not e.traits
    assert len(e.abc.bodies) == len(e.original_bodies)
    for n, before in originals.items():
        after = getattr(e.abc, n)
        assert freeze(after[:len(before)] if n in POOLS else after) == freeze(before), n
    for n in ('ints', 'uints', 'doubles'):
        assert len(getattr(e.abc, n)) == len(originals[n]), ('numeric pool grew', n)
    labels = bodies.label_map(e.abc)
    changed = [i for i, (x, y) in enumerate(zip(e.original_bodies, e.abc.bodies)) if body_bytes(x) != body_bytes(y)]
    for i in changed:
        assert labels[i].split('/')[0].split('$')[0] not in PROTECTED, labels[i]
    assert sorted(labels[i] for i in changed) == sorted(METHODS), sorted(labels[i] for i in changed)
    for label, row in e.report.items():
        assert asm.unsplice_many(e.body(label)[5], row['insertions']) == e.original_bodies[row['body']][5]
    raw = e.swf.serialize()
    restored = copy.deepcopy(e.swf)
    for i in changed:
        restored.abc.bodies[i] = copy.deepcopy(e.original_bodies[i])
    for n in POOLS:
        setattr(restored.abc, n, copy.deepcopy(originals[n]))
    assert restored.serialize() == raw_in, 'reverse does not recover input SWF'
    added = [s.decode('utf-8', 'replace') for s in e.abc.strings[len(originals['strings']):]]
    for word in ('admission', 'SP-ADMISSION'):
        assert not [s for s in added if word in s], ('admission-related string added', added)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(raw)
    growth = {n: len(getattr(e.abc, n)) - len(originals[n]) for n in POOLS}
    report = {'status': 'passed', 'features': ['c26_own_riven_filter'], 'input': str(src), 'input_sha256': sha(raw_in),
              'output': str(out), 'output_sha256': sha(raw), 'changed_methods': sorted(labels[i] for i in changed),
              'changed_method_count': len(changed), 'insert_count': len(rows), 'inserts': rows,
              'pool_growth': growth, 'appended_strings': added,
              'new_methods': 0, 'new_traits': 0, 'structural_tables_identical': True,
              'reverse_recovers_input_swf': True, 'protected_classes_untouched': list(PROTECTED),
              'ui': {'asset': ASSET, 'container': CONTAINER, 'position': [POS_X, POS_Y], 'height_growth': GROW,
                     'kind': KIND, 'label': LABEL, 'config': 'Box(boxPureWhiteColor, white, text)'},
              'static_checks': {k: v.get('static_check') for k, v in e.report.items()},
              'insertion_recovery': {k: {'body': v['body'], 'insertions': v['insertions']} for k, v in e.report.items()}}
    if a.report:
        Path(a.report).parent.mkdir(parents=True, exist_ok=True)
        Path(a.report).write_text(json.dumps(report, ensure_ascii=False, indent=1, default=repr) + '\n', 'utf-8')
    print(json.dumps({k: report[k] for k in ('status', 'output_sha256', 'changed_method_count', 'insert_count',
                                             'pool_growth')}, ensure_ascii=False))
    return report


if __name__ == '__main__':
    main()
