"""(a) 分解 in the riven detail popup (AbilitySoulDetailDialog, C9 lock metadata).

Shown only when the popup belongs to EquipmentListScene (裂罅工坊 / weapon list
riven category) or ItemListScene (道具一览 riven group).  Flow:
  分解 (Box button beside the C9 lock) -> native GeneralDialog confirm opened on top
  (AbilitySoulFilterDialog precedent: logicScene.openDialog from a dialog)
  -> confirm calls detail.buttonClicked(CONFIRM) -> weapon_riven/dismantle
     {item_id, riven_id} through RealRemoteService.startUserRequest (C9 lock transport)
  -> response routed to the existing (int,int,Object) slider callback with our ids.
Conflict: C9 notice path shows 「裂罅已变化，请重试」(locked -> 已锁定) and the list refreshes.
Success: popup closes, scene list refreshes, instant message 「已分解，获得裂罅碎片 ×N」.
"""
import asm
from c23_common import (Emit, g, p, ops_of, mn, TEXT, LOCK_KEY, LOCK_BUTTON,
                        DETAIL_DISMANTLE, DETAIL_CONFIRM, DETAIL_RESPONSE)

ELS = 'pinball.scene.equipmentList::EquipmentListScene'
ILS = 'pinball.scene.itemList.itemList::ItemListScene'


def scene_refresh(m, scene, scratch, tag):
    """Refresh the list behind the popup (riven category or item list)."""
    q = m.q
    return [('pushnull',), p(scene), *m.has([('getlocal_0',)], 'logicScene', tag + '_done'),
            ('getlocal_0',), m.gp('logicScene'), ('coerce_a',), p(scene),
            g(scene), ('iffalse', tag + '_done'),
            g(scene), ('istype', q(ELS)), ('iffalse', tag + '_item'),
            g(scene), m.gp('filterSetting'), ('coerce_a',), p(scratch), g(scratch), ('iffalse', tag + '_done'),
            *m.flag(scratch, 'wfxRiven', tag + '_rv'), ('iffalse', tag + '_done'),
            g(scene), g(scene), ('callproperty', q('getFilteredEquipmentList'), 0),
            ('setproperty', q('equipmentIds')),
            g(scene), ('callpropvoid', q('rebuildAllThumbnails'), 0), ('jump', tag + '_done'),
            ('label', tag + '_item'), g(scene), ('istype', q(ILS)), ('iffalse', tag + '_done'),
            g(scene), ('callpropvoid', q('refreshItems'), 0),
            ('label', tag + '_done')]


def queue_preparation(q):
    """Add our id to the original constructor id list (C10 pattern; avoids G2007)."""
    e = q.e
    label = 'GeneralDialog/preparation'
    ops = ops_of(e, label)
    hits = [i for i in range(2, len(ops) - 1)
            if ops[i].name == 'findproperty' and mn(e, ops[i]) == 'buttonGroup'
            and ops[i + 1].name == 'findpropstrict' and mn(e, ops[i + 1]).endswith('::ButtonGroupLogic')
            and ops[i - 1].name == 'callpropvoid' and mn(e, ops[i - 1]).endswith('::push')
            and ops[i - 2].name == 'pushint' and e.abc.ints[ops[i - 2].args[0]] == LOCK_BUTTON]
    assert len(hits) == 1, ('preparation anchor', hits)
    at = hits[0]
    assert ops[at - 3].name == 'getlocal' and ops[at - 3].args == [4]
    m = Emit(e, label, 4)
    meta = m.local()
    code = m.lock_meta(meta, 'done') + [('getlocal', 4), m.n(DETAIL_DISMANTLE),
                                        ('callpropvoid', m.q('http://adobe.com/AS3/2006/builtin::push'), 1),
                                        ('label', 'done')]
    q.add('detail', label, at, code, asm.ENTER, 'push 分解 id into the native ButtonGroupLogic id array')
    return {'method': label, 'at': at}


def queue_view(q):
    """Box 分解 beside the C9 lock control (same row), registered on the dialog button view."""
    e = q.e
    label = 'GeneralDialogView/run'
    ops = ops_of(e, label)
    hits = [i for i in range(4, len(ops) - 1)
            if ops[i].name == 'callpropvoid' and mn(e, ops[i]) == 'registerDisplayObjectAsButton'
            and ops[i - 4].name == 'pushint' and e.abc.ints[ops[i - 4].args[0]] == LOCK_BUTTON]
    assert len(hits) == 1, ('view anchor', hits)
    at = hits[0] + 1
    assert ops[at].name == 'jump'
    m = Emit(e, label, 8)
    meta, node, scene, sprite, width = m.locals(5)
    qq = m.q
    code = [('getlocal', 13), ('iffalse', 'done'), *m.has([('getlocal', 13)], LOCK_KEY, 'done'),
            ('getlocal', 13), *m.get(LOCK_KEY), ('coerce_a',), p(meta), g(meta), ('iffalse', 'done'),
            *m.has([g(meta)], 'node', 'done'), g(meta), *m.get('node'), ('coerce_a',), p(node),
            g(node), ('iffalse', 'done'),
            *m.has([('getlocal_0',)], 'peek', 'done'), ('getlocal_0',), m.gp('peek'), ('coerce_a',), p(scene),
            g(scene), ('iffalse', 'done'), *m.has([g(scene)], 'logicScene', 'done'),
            g(scene), m.gp('logicScene'), ('coerce_a',), p(scene), g(scene), ('iffalse', 'done'),
            g(scene), ('istype', qq(ELS)), ('iftrue', 'scene_ok'),
            g(scene), ('istype', qq(ILS)), ('iffalse', 'done'),
            ('label', 'scene_ok'),
            # content width: DialogAbilitySoulDetailView.layout.width (local 41), else 640
            m.n(640), ('convert_d',), p(width),
            *m.has([('getlocal', 41)], 'layout', 'width_done'),
            ('getlocal', 41), m.gp('layout'), ('coerce_a',), p(sprite), g(sprite), ('iffalse', 'width_done'),
            g(sprite), m.gp('width'), ('convert_d',), p(width),
            g(width), m.n(400), ('ifge', 'width_done'), m.n(640), ('convert_d',), p(width),
            ('label', 'width_done'),
            ('getlex', qq('starling.display::Sprite')), ('construct', 0), ('coerce_a',), p(sprite),
            g(node), m.gp('parent'), g(sprite), ('callpropvoid', qq('addChild'), 1),
            # lock centred at 30% width, 分解 centred at 70%, same row
            g(node), g(width), m.n(3), ('multiply',), m.n(10), ('divide',),
            g(node), m.gp('width'), m.n(2), ('divide',), ('subtract',), ('setproperty', qq('x')),
            g(sprite), g(width), m.n(7), ('multiply',), m.n(10), ('divide',), ('setproperty', qq('x')),
            g(sprite), g(node), m.gp('y'), g(node), m.gp('height'), m.n(2), ('divide',), ('add',),
            ('setproperty', qq('y')),
            ('getlocal_0',), m.gp('buttonGroupView'), m.n(DETAIL_DISMANTLE), g(sprite),
            ('getlex', qq('flash.geom::Rectangle')), m.n(0), m.n(0), m.n(240), m.n(88), ('construct', 4),
            ('getlex', qq('pinball.ui.component.button.config::ButtonConfigs')), m.s(TEXT['detail_button']),
            ('callproperty', qq('negativeWithCustomString'), 1), ('callpropvoid', qq('addWithConfig'), 4),
            g(meta), *m.set('c23_node', [g(sprite)]),
            ('label', 'done')]
    q.add('detail', label, at, code, asm.ENTER, 'Box 分解 on the lock row; only EquipmentListScene/ItemListScene')
    return {'method': label, 'at': at}


def queue_click(q):
    e = q.e
    label = 'GeneralDialog/buttonClicked'
    ops = ops_of(e, label)
    assert [o.name for o in ops[:2]] == ['getlocal_0', 'pushscope']
    assert ops[2].name == 'getlocal_1' and ops[3].name == 'pushint' and e.abc.ints[ops[3].args[0]] == LOCK_BUTTON, \
        'expects the C9 lock prefix at index 2'
    m = Emit(e, label, 16)
    meta, ident, riv, rec, locked, pending, total, idx, row, msg, target = m.locals(11)
    qq = m.q
    this = [('getlocal_0',)]
    code = [('getlocal_1',), m.n(DETAIL_DISMANTLE), ('ifne', 'not_open')]
    code += m.lock_meta(meta, 'done')
    code += [*m.flag(meta, 'pending', 'mp'), ('iftrue', 'done'),
             g(meta), *m.get('item_id'), ('convert_i',), p(ident),
             *m.rivens(riv, 'stale'), *m.record(riv, ident, rec, 'stale'),
             g(rec), *m.get('riven_id'), g(meta), *m.get('riven_id'), ('ifne', 'stale'),
             *m.blocked(rec, locked, pending, 'ob'),
             g(locked), ('iffalse', 'not_locked'), *m.instant(this, [m.s(TEXT['locked'])]), ('jump', 'done'),
             ('label', 'not_locked'), g(pending), ('iffalse', 'free'),
             *m.instant(this, [m.s(TEXT['pending'])]), ('jump', 'done'),
             ('label', 'free'), ('pushbyte', 0), p(total), *m.fragments(rec, total, idx, row, 'of'),
             g(meta), *m.set('c23_target', [g(rec), *m.get('riven_id')]),
             g(meta), *m.set('c23_gain', [g(total)]),
             m.s(TEXT['confirm_one']), p(msg),
             g(total), ('pushbyte', 0), ('ifgt', 'gain'),
             g(msg), m.s(TEXT['gain_none']), ('add',), p(msg), ('jump', 'gain_done'),
             ('label', 'gain'), g(msg), m.s(TEXT['gain_prefix']), ('add',), g(total), ('add',), p(msg),
             ('label', 'gain_done'),
             ('getlocal_0',), m.gp('logicScene'),
             *m.confirm_dialog([g(msg)], this, DETAIL_CONFIRM),
             ('callpropvoid', qq('openDialog'), 1), ('jump', 'done'),
             ('label', 'not_open'), ('getlocal_1',), m.n(DETAIL_CONFIRM), ('ifne', 'original')]
    code += m.lock_meta(meta, 'done')
    code += [*m.flag(meta, 'pending', 'cp'), ('iftrue', 'done'),
             *m.has([g(meta)], 'c23_target', 'done'), g(meta), *m.get('c23_target'), ('coerce_a',), p(target),
             g(target), ('iffalse', 'done'), g(meta), *m.set('c23_target', [('pushnull',)]),
             g(meta), *m.get('item_id'), ('convert_i',), p(ident),
             *m.rivens(riv, 'stale'), *m.record(riv, ident, rec, 'stale'),
             g(rec), *m.get('riven_id'), g(target), ('ifne', 'stale'),
             *m.blocked(rec, locked, pending, 'cb'),
             g(locked), ('iffalse', 'c_not_locked'), *m.instant(this, [m.s(TEXT['locked'])]), ('jump', 'done'),
             ('label', 'c_not_locked'), g(pending), ('iffalse', 'c_free'),
             *m.instant(this, [m.s(TEXT['pending'])]), ('jump', 'done'),
             ('label', 'c_free'), g(meta), *m.set('pending', [('pushtrue',)]),
             *m.remote(this, 'weapon_riven/dismantle',
                       [m.s('item_id'), g(ident), m.s('riven_id'), g(rec), *m.get('riven_id'), ('newobject', 2)],
                       [('getlex', qq('pinball.common.tools._FunctionTools::BindImpl3_1')), ('getlocal_0',),
                        m.gp('sliderValueChangedForAbilityDescriptionVariationWithLevel'),
                        m.n(DETAIL_DISMANTLE), m.n(DETAIL_RESPONSE), ('construct', 3), m.gp('execute')]),
             ('jump', 'done'),
             ('label', 'stale'), *m.instant(this, [m.s(TEXT['changed'])]),
             ('label', 'done'), ('returnvoid',), ('label', 'original')]
    q.add('detail', label, 2, code, asm.FORBID, '分解 -> native confirm on top -> weapon_riven/dismantle')
    return {'method': label, 'at': 2}


def queue_response(q):
    e = q.e
    label = 'GeneralDialog/sliderValueChangedForAbilityDescriptionVariationWithLevel'
    ops = ops_of(e, label)
    assert ops[2].name == 'getlocal_1' and ops[3].name == 'pushint' and e.abc.ints[ops[3].args[0]] == LOCK_BUTTON
    m = Emit(e, label, 10)
    meta, data, scene, gain, msg, reason, scratch = m.locals(7)
    this = [('getlocal_0',)]
    code = [('getlocal_1',), m.n(DETAIL_DISMANTLE), ('ifne', 'original'),
            ('getlocal_2',), m.n(DETAIL_RESPONSE), ('ifne', 'original')]
    code += m.lock_meta(meta, 'done')
    code += [g(meta), *m.set('pending', [('pushfalse',)]),
             ('pushbyte', 0), p(gain), *m.has([g(meta)], 'c23_gain', 'gain_read'),
             g(meta), *m.get('c23_gain'), ('convert_i',), p(gain), ('label', 'gain_read'),
             ('getlocal_3',), ('iffalse', 'done'), ('getlocal_3',), m.gp('rawData'), ('coerce_a',), p(data),
             g(data), ('iffalse', 'done'), *m.has([g(data)], 'data', 'done'),
             g(data), *m.get('data'), ('coerce_a',), p(data), g(data), ('iffalse', 'done'),
             *m.flag(data, 'weapon_riven_conflict', 'rc'), ('iffalse', 'success'),
             m.s(''), p(reason), *m.has([g(data)], 'reason', 'reason_read'),
             g(data), *m.get('reason'), p(reason), ('label', 'reason_read'),
             g(meta), m.s('notice'), g(reason), m.s('locked'), ('ifne', 'changed'),
             m.s(TEXT['locked']), ('jump', 'notice'), ('label', 'changed'), m.s(TEXT['changed']),
             ('label', 'notice'), ('setproperty', 14),
             *scene_refresh(m, scene, scratch, 'rf1'), ('jump', 'done'),
             ('label', 'success'),
             *scene_refresh(m, scene, scratch, 'rf2'),
             g(gain), ('pushbyte', 0), ('ifgt', 'with_gain'), m.s(TEXT['done_one_plain']), p(msg), ('jump', 'msg_done'),
             ('label', 'with_gain'), m.s(TEXT['done_one']), g(gain), ('add',), p(msg), ('label', 'msg_done'),
             ('getlocal_0',), ('callpropvoid', m.q('close'), 0),
             g(scene), ('iffalse', 'done'), *m.instant([g(scene)], [g(msg)]),
             ('label', 'done'), ('returnvoid',), ('label', 'original')]
    q.add('detail', label, 2, code, asm.FORBID, 'dismantle response: conflict notice / success close+refresh+message')
    return {'method': label, 'at': 2}


def queue_detail(q):
    return {'preparation': queue_preparation(q), 'view': queue_view(q),
            'click': queue_click(q), 'response': queue_response(q)}
