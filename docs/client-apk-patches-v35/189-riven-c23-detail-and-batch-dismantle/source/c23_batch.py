"""(b) 批量分解 mode on the 裂罅工坊 list (EquipmentListScene, filterSetting.wfxRiven).

Native pattern reused (official equipment bulk sell): the scene's own
checkButtonStatus = BulkSelect is the mode, bulkSelector.selectedEquipmentIds is the
selection set (row keys 0x05000000|item_id), viewSceneOrder.updateThumbnailSelected
drives the native thumbnail check mark (ItemThumbnailView.select), Box buttons sit at
the native footer upgrade/sell positions, the footer craft-point texts become the
count/fragment bar, and a native GeneralDialog Select is the confirm.

  批量分解 (sell slot)    -> mode on, hint
  row tap in mode          -> toggle; locked / pending draw refused (dimmed), cap 20
  取消 (upgrade slot)      -> mode off, marks cleared
  分解 (sell slot)         -> snapshot {item_id, revision} -> confirm dialog
  confirm -> buttonClicked(SEND) -> re-verify -> POST weapon_riven/dismantle_batch
  response -> filterDialogOkHandler(ResponseData) (Object-typed native callback)
     conflict: 「裂罅已变化，请重试」, prune invalid selections, refresh, stay in mode
     success : common response already applied by RealRemoteService; leave mode,
               refresh, OkDialog 「分解了 N 张裂罅，获得裂罅碎片 ×M」 (dismantle_return_total)
"""
import asm
from c23_common import (Emit, g, p, ops_of, mn, TEXT, ICON_NAME, DIM_NAME, FRAGMENT, ROW, LOWER, UPPER,
                        CAP, B_ENTER, B_CANCEL, B_CONFIRM, B_SEND)

STATUS = 'pinball.scene.equipmentList::EquipmentListCheckButtonStatus'
BATCH_PATH = 'weapon_riven/dismantle_batch'


def view_mn(e, name):
    """Multiname the native scene uses for viewSceneOrder.<name> (interface namespace)."""
    for label in ('EquipmentListScene/selectEquipment', 'EquipmentListScene/changeCheckButtonStatus'):
        for op in ops_of(e, label):
            if op.name in ('callpropvoid', 'callproperty') and e.abc.mn_name(op.args[0]).endswith('::' + name):
                return op.args[0]
    raise AssertionError('no native multiname for ' + name)


def flag_prop(m, obj_local, key, out, tag):
    """out = Boolean(obj[key]) with an `in` guard."""
    return [*m.flag(obj_local, key, tag), p(out)]


def mode_flags(m, riven, batch, scratch, tag):
    """riven = filterSetting.wfxRiven; batch = riven && checkButtonStatus.index == 2 (BulkSelect)."""
    return [('pushfalse',), p(riven), ('pushfalse',), p(batch),
            *m.has([('getlocal_0',)], 'filterSetting', tag + '_end'),
            ('getlocal_0',), m.gp('filterSetting'), ('coerce_a',), p(scratch), g(scratch), ('iffalse', tag + '_end'),
            *flag_prop(m, scratch, 'wfxRiven', riven, tag + '_r'), g(riven), ('iffalse', tag + '_end'),
            *m.has([('getlocal_0',)], 'checkButtonStatus', tag + '_end'),
            ('getlocal_0',), m.gp('checkButtonStatus'), ('coerce_a',), p(scratch), g(scratch), ('iffalse', tag + '_end'),
            g(scratch), m.gp('index'), ('pushbyte', 2), ('equals',), p(batch),
            ('label', tag + '_end')]


def selected(m, out, fail):
    return [('getlocal_0',), m.gp('bulkSelector'), ('coerce_a',), p(out), g(out), ('iffalse', fail),
            g(out), m.gp('selectedEquipmentIds'), ('coerce_a',), p(out), g(out), ('iffalse', fail)]


def refresh(m):
    q = m.q
    return [('getlocal_0',), ('getlocal_0',), ('callproperty', q('getFilteredEquipmentList'), 0),
            ('setproperty', q('equipmentIds')), ('getlocal_0',), ('callpropvoid', q('rebuildAllThumbnails'), 0)]


def prune_refresh(m, L, tag):
    """Drop selected rows whose card vanished or became locked/pending, then rebuild the list."""
    sel, riv, i, ident, rec, lk, pd = L['sel'], L['riv'], L['i'], L['ident'], L['rec'], L['lk'], L['pd']
    q = m.q
    return [*m.rivens(riv, tag + '_rebuild'), *selected(m, sel, tag + '_rebuild'),
            g(sel), m.gp('length'), ('pushbyte', 1), ('subtract',), ('convert_i',), p(i),
            ('label', tag + '_loop'), ('avm_label',), g(i), ('pushbyte', 0), ('iflt', tag + '_rebuild'),
            g(sel), g(i), ('getproperty', 14), ('convert_i',), m.n(0xFFFFFF), ('bitand',), p(ident),
            *m.record(riv, ident, rec, tag + '_drop'), *m.blocked(rec, lk, pd, tag + '_b'),
            g(lk), ('iftrue', tag + '_drop'), g(pd), ('iftrue', tag + '_drop'), ('jump', tag + '_next'),
            ('label', tag + '_drop'), g(sel), g(i), ('pushbyte', 1),
            ('callpropvoid', q('http://adobe.com/AS3/2006/builtin::splice'), 2),
            ('label', tag + '_next'), ('declocal_i', i), ('jump', tag + '_loop'),
            ('label', tag + '_rebuild'), *refresh(m)]


def exit_batch(m, L, tag):
    q = m.q
    sel, i, key = L['sel'], L['i'], L['key']
    upd = view_mn(m.e, 'updateThumbnailSelected')
    return [*selected(m, sel, tag + '_clear'), ('pushbyte', 0), p(i),
            ('label', tag + '_loop'), ('avm_label',), g(i), g(sel), m.gp('length'), ('ifge', tag + '_clear'),
            g(sel), g(i), ('getproperty', 14), ('convert_i',), p(key),
            ('getlocal_0',), m.gp('viewSceneOrder'), g(key), ('pushfalse',), ('callpropvoid', upd, 2),
            ('inclocal_i', i), ('jump', tag + '_loop'),
            ('label', tag + '_clear'),
            ('getlocal_0',), m.gp('bulkSelector'), ('callpropvoid', q('deselectAll'), 0),
            ('getlocal_0',), ('getlex', q(STATUS)), m.gp('Normal'), ('setproperty', q('checkButtonStatus'))]


def queue_run_ids(q):
    e = q.e
    label = 'EquipmentListScene/run'
    ops = ops_of(e, label)
    hits = [i for i in range(2, len(ops) - 1) if ops[i].name == 'pushint' and e.abc.ints[ops[i].args[0]] == 67108864
            and ops[i + 1].name == 'callpropvoid' and mn(e, ops[i + 1]).endswith('::push')
            and ops[i - 1].name == 'getlocal_2' and ops[i + 2].name == 'findproperty'
            and mn(e, ops[i + 2]) == 'buttonGroup']
    assert len(hits) == 1, hits
    at = hits[0] + 2
    m = Emit(e, label, 1)
    push = ('callpropvoid', m.q('http://adobe.com/AS3/2006/builtin::push'), 1)
    code = []
    for ident in (B_ENTER, B_CANCEL, B_CONFIRM):
        code += [('getlocal_2',), m.n(ident), push]
    q.add('batch', label, at, code, asm.FORBID, 'native ButtonGroupLogic ids for 批量分解/取消/分解')
    return {'method': label, 'at': at}


def queue_footer(q):
    e = q.e
    label = 'EquipmentListView/setupHowToButton'
    ops = ops_of(e, label)
    assert ops[-1].name == 'returnvoid'
    icon = [i for i in range(2, len(ops)) if ops[i].name == 'callpropvoid' and mn(e, ops[i]) == 'addChild'
            and ops[i - 1].name == 'getlocal' and ops[i - 2].name == 'getproperty' and mn(e, ops[i - 2]) == 'craftPointLayer']
    assert len(icon) == 1, icon
    icon_local = ops[icon[0] - 1].args[0]
    m = Emit(e, label, 6)
    layer, src, sprite, rect, logic = m.locals(5)
    qq = m.q
    code = [('getlocal', icon_local), ('iffalse', 'icon_done'), ('getlocal', icon_local), m.s(ICON_NAME),
            ('setproperty', qq('name')), ('label', 'icon_done'),
            # register only ids the scene really put in its ButtonGroupLogic (EquipmentListScene/run)
            *m.has([('getlocal_0',)], 'buttonGroupView', 'done'), ('getlocal_0',), m.gp('buttonGroupView'),
            ('coerce_a',), p(logic), g(logic), ('iffalse', 'done'), *m.has([g(logic)], 'peek', 'done'),
            g(logic), m.gp('peek'), ('coerce_a',), p(logic), g(logic), ('iffalse', 'done'),
            *m.has([g(logic)], 'exists', 'done'),
            ('getlocal_1',), ('iffalse', 'done'),
            ('getlocal_1',), m.s('footer'), ('pushnull',), ('callproperty', qq('getContainer'), 2), ('coerce_a',), p(layer),
            g(layer), ('iffalse', 'done'),
            g(layer), m.s('button_layer'), ('pushnull',), ('callproperty', qq('getContainer'), 2), ('coerce_a',), p(layer),
            g(layer), ('iffalse', 'done')]
    for n, (ident, slot, text, positive) in enumerate([(B_ENTER, 'sell_button', TEXT['enter'], False),
                                                       (B_CANCEL, 'upgrade_button', TEXT['cancel'], False),
                                                       (B_CONFIRM, 'sell_button', TEXT['confirm'], True)]):
        skip = 'skip%d' % n
        code += [g(logic), m.n(ident), ('callproperty', qq('exists'), 1), ('iffalse', skip),
                 g(layer), m.s(slot), ('pushnull',), ('callproperty', qq('getContainer'), 2), ('coerce_a',), p(src),
                 g(src), ('iffalse', skip),
                 ('getlex', qq('starling.display::Sprite')), ('construct', 0), ('coerce_a',), p(sprite),
                 g(sprite), g(src), m.gp('x'), ('setproperty', qq('x')),
                 g(sprite), g(src), m.gp('y'), ('setproperty', qq('y')),
                 g(layer), g(sprite), ('callpropvoid', qq('addChild'), 1),
                 g(src), m.s('area'), ('pushnull',), ('callproperty', qq('getGuideRectangle'), 2), ('coerce_a',), p(rect),
                 ('getlocal_0',), m.gp('buttonGroupView'), m.n(ident), g(sprite), g(rect),
                 ('getlex', qq('pinball.ui.component.button.config::ButtonConfigs')), m.s(text),
                 ('callproperty', qq('positiveWithCustomString' if positive else 'negativeWithCustomString'), 1),
                 ('callpropvoid', qq('addWithConfig'), 4), ('label', skip)]
    code += [('label', 'done')]
    q.add('batch', label, len(ops) - 1, code, asm.ENTER, 'Box 批量分解/取消/分解 at the native footer slots')
    return {'method': label, 'at': len(ops) - 1, 'icon_local': icon_local}


def queue_update(q):
    """Per frame: button visibility/enabled, footer bar texts, ctx.c23_batch_on for row dimming."""
    e = q.e
    label = 'EquipmentListScene/update'
    ops = ops_of(e, label)
    assert [o.name for o in ops[:3]] == ['getlocal_0', 'pushscope', 'findproperty']
    m = Emit(e, label, 30)
    names = 'riven batch scr ctx grp sel ids i key ident riv rec total count idx row layer node want text'.split()
    L = dict(zip(names, m.locals(len(names))))
    riven, batch, scr, ctx, grp = L['riven'], L['batch'], L['scr'], L['ctx'], L['grp']
    sel, ids, i, key, ident, riv, rec = L['sel'], L['ids'], L['i'], L['key'], L['ident'], L['riv'], L['rec']
    total, count, idx, row, layer, node, want, text = (L[k] for k in 'total count idx row layer node want text'.split())
    qq = m.q

    def vis(ident_, value):
        return [g(grp), m.n(ident_), ('callproperty', qq('get'), 1), *value, ('setproperty', qq('visible'))]

    def and_(a, b, tag):
        return [g(a), ('dup',), ('iffalse', tag), ('pop',), *b, ('label', tag)]

    def text_set(name, value, tag):
        return [g(layer), m.s(name), ('pushnull',), ('callproperty', qq('getText'), 2), ('coerce_a',), p(node),
                g(node), ('iffalse', tag), *value, p(want), g(node), ('callproperty', qq('get_text'), 0), g(want),
                ('ifeq', tag), g(node), g(want), ('callpropvoid', qq('set_text'), 1), ('label', tag)]

    def comma(value):
        return [('getlex', qq('pinball.common.tools::StringExtended')),
                ('getlex', qq('pinball.common.math._FloatInt::FloatInt_Impl_')), *value, ('convert_i',),
                ('callproperty', qq('fromInt'), 1), ('convert_d',), ('callproperty', qq('commaSeparate'), 1)]

    code = mode_flags(m, riven, batch, scr, 'mf')
    code += [*m.ctx(ctx, scr, 'no_ctx'), g(ctx), *m.set('c23_batch_on', [g(batch)]), ('label', 'no_ctx')]
    # buttons
    code += [*m.has([('getlocal_0',)], 'buttonGroup', 'done'), ('getlocal_0',), m.gp('buttonGroup'), ('coerce_a',), p(grp),
             g(grp), ('iffalse', 'done'), *m.has([g(grp)], 'exists', 'done'),
             g(grp), m.n(B_ENTER), ('callproperty', qq('exists'), 1), ('iffalse', 'done'),
             *vis(B_ENTER, and_(riven, [g(batch), ('not',)], 'v1')),
             *vis(B_CANCEL, and_(riven, [g(batch)], 'v2')),
             *vis(B_CONFIRM, and_(riven, [g(batch)], 'v3')),
             ('pushbyte', 0), p(count), ('pushbyte', 0), p(total),
             g(batch), ('iffalse', 'counted'),
             *selected(m, sel, 'counted'),
             ('getlocal_0',), m.gp('equipmentIds'), ('coerce_a',), p(ids), g(ids), ('iffalse', 'counted'),
             *m.rivens(riv, 'counted'), ('pushbyte', 0), p(i),
             ('label', 'cloop'), ('avm_label',), g(i), g(sel), m.gp('length'), ('ifge', 'counted'),
             g(sel), g(i), ('getproperty', 14), ('convert_i',), p(key),
             g(ids), g(key), ('callproperty', qq('http://adobe.com/AS3/2006/builtin::indexOf'), 1),
             ('pushbyte', 0), ('iflt', 'cnext'), ('inclocal_i', count),
             g(key), m.n(0xFFFFFF), ('bitand',), p(ident), *m.record(riv, ident, rec, 'cnext'),
             *m.fragments(rec, total, idx, row, 'cf'),
             ('label', 'cnext'), ('inclocal_i', i), ('jump', 'cloop'),
             ('label', 'counted'),
             g(grp), m.n(B_CONFIRM), ('callproperty', qq('get'), 1),
             g(count), ('pushbyte', 0), ('ifgt', 'en1'), ('pushbyte', 4), ('jump', 'en2'), ('label', 'en1'),
             ('pushbyte', 1), ('label', 'en2'), ('callpropvoid', qq('set_enabled'), 1)]
    # footer bar (native craft-point layer of the view)
    code += [*m.has([('getlocal_0',)], 'viewSceneOrder', 'done'), ('getlocal_0',), m.gp('viewSceneOrder'),
             ('coerce_a',), p(layer), g(layer), ('iffalse', 'done'),
             *m.has([g(layer)], 'craftPointLayer', 'done'), g(layer), m.gp('craftPointLayer'), ('coerce_a',), p(layer),
             g(layer), ('iffalse', 'done'),
             g(layer), m.s(ICON_NAME), ('callproperty', qq('getChildByName'), 1), ('coerce_a',), p(text),
             g(text), ('iffalse', 'done'),
             g(riven), ('iftrue', 'bar_riven'),
             # equipment mode: restore once (icon hidden means we changed it)
             g(text), m.gp('visible'), ('iftrue', 'done'),
             g(text), ('pushtrue',), ('setproperty', qq('visible')),
             *text_set('title_text', [('getlocal_0',), m.gp('logic'), m.gp('asset'), m.s('item_craft_point'),
                                      ('callproperty', qq('getUiString'), 1)], 't1'),
             *text_set('number_text', comma([('getlocal_0',), ('callproperty', qq('getCraftPoint'), 0)]), 't2'),
             ('jump', 'done'),
             ('label', 'bar_riven'),
             g(text), m.gp('visible'), ('iffalse', 'icon_hidden'), g(text), ('pushfalse',), ('setproperty', qq('visible')),
             ('label', 'icon_hidden'),
             g(batch), ('iftrue', 'bar_batch'),
             *text_set('title_text', [m.s(TEXT['bar_owned'])], 't3'),
             *text_set('number_text', comma([('getlocal_0',), m.gp('player'), m.n(FRAGMENT),
                                             ('callproperty', qq('getItemNumber'), 1)]), 't4'),
             ('jump', 'done'),
             ('label', 'bar_batch'),
             *text_set('title_text', [m.s(TEXT['bar_batch_a']), g(count), ('add',), m.s(TEXT['bar_batch_b']), ('add',)], 't5'),
             *text_set('number_text', comma([g(total)]), 't6'),
             ('label', 'done')]
    q.add('batch', label, 2, code, asm.FORBID, 'per-frame mode/buttons/footer bar')
    return {'method': label, 'at': 2}


def queue_click(q):
    e = q.e
    label = 'EquipmentListScene/buttonClicked'
    ops = ops_of(e, label)
    assert [o.name for o in ops[:2]] == ['getlocal_0', 'pushscope']
    # C3 prefix starts at 2 with the TOGGLE test; ours goes in front of it.
    assert ops[2].name == 'getlocal_1' and ops[3].name == 'pushint' and e.abc.ints[ops[3].args[0]] == 0x01000000
    m = Emit(e, label, 40)
    names = ('riven batch scr ctx st sel ids i key ident riv rec lk pd total count idx row items msg pos item '
             'scratch').split()
    L = dict(zip(names, m.locals(len(names))))
    riven, batch, scr, ctx, st = L['riven'], L['batch'], L['scr'], L['ctx'], L['st']
    sel, ids, i, key, ident, riv, rec = L['sel'], L['ids'], L['i'], L['key'], L['ident'], L['riv'], L['rec']
    lk, pd, total, count, idx, row, items, msg, pos, item = (L[k] for k in
                                                             'lk pd total count idx row items msg pos item'.split())
    qq = m.q
    this = [('getlocal_0',)]
    upd = view_mn(e, 'updateThumbnailSelected')
    push = ('callpropvoid', qq('http://adobe.com/AS3/2006/builtin::push'), 1)
    index_of = ('callproperty', qq('http://adobe.com/AS3/2006/builtin::indexOf'), 1)

    def effective(tag, with_items):
        """Walk selected rows that are still shown; fail to `tag_changed` on a vanished/blocked card."""
        code = [*selected(m, sel, tag + '_end'), ('getlocal_0',), m.gp('equipmentIds'), ('coerce_a',), p(ids),
                g(ids), ('iffalse', tag + '_end'), *m.rivens(riv, tag + '_end'),
                ('pushbyte', 0), p(count), ('pushbyte', 0), p(total), ('pushbyte', 0), p(i)]
        if with_items:
            code += [('newarray', 0), p(items)]
        code += [('label', tag + '_loop'), ('avm_label',), g(i), g(sel), m.gp('length'), ('ifge', tag + '_end'),
                 g(sel), g(i), ('getproperty', 14), ('convert_i',), p(key),
                 g(ids), g(key), index_of, ('pushbyte', 0), ('iflt', tag + '_next'),
                 ('inclocal_i', count), g(key), m.n(0xFFFFFF), ('bitand',), p(ident)]
        if with_items:
            code += [*m.record(riv, ident, rec, 'changed'), *m.blocked(rec, lk, pd, tag + '_b'),
                     g(lk), ('iftrue', 'changed'), g(pd), ('iftrue', 'changed'),
                     g(items), m.s('item_id'), g(ident), m.s('revision'), g(rec), *m.get('revision'),
                     ('convert_i',), ('newobject', 2), push,
                     *m.fragments(rec, total, idx, row, tag + '_f')]
        code += [('label', tag + '_next'), ('inclocal_i', i), ('jump', tag + '_loop'), ('label', tag + '_end')]
        return code

    code = [('getlocal_1',), m.n(B_ENTER), ('ifne', 'k_cancel'),
            *mode_flags(m, riven, batch, scr, 'm1'), g(riven), ('iffalse', 'drop'), g(batch), ('iftrue', 'drop'),
            ('getlocal_0',), m.gp('bulkSelector'), ('callpropvoid', qq('deselectAll'), 0),
            ('getlocal_0',), ('getlex', qq(STATUS)), m.gp('BulkSelect'), ('setproperty', qq('checkButtonStatus')),
            *m.instant(this, [m.s(TEXT['hint'])]), ('returnvoid',),
            ('label', 'k_cancel'), ('getlocal_1',), m.n(B_CANCEL), ('ifne', 'k_confirm'),
            *mode_flags(m, riven, batch, scr, 'm2'), g(batch), ('iffalse', 'drop'),
            *exit_batch(m, L, 'x1'), ('returnvoid',),
            ('label', 'k_confirm'), ('getlocal_1',), m.n(B_CONFIRM), ('ifne', 'k_send'),
            *mode_flags(m, riven, batch, scr, 'm3'), g(batch), ('iffalse', 'drop'),
            *m.ctx(ctx, scr, 'drop'),
            ('pushnull',), p(st), *m.has([g(ctx)], 'c23_batch', 'no_state'), g(ctx), *m.get('c23_batch'), ('coerce_a',), p(st),
            ('label', 'no_state'), g(st), ('iffalse', 'idle'),
            g(st), *m.get('scene'), ('getlocal_0',), ('ifstrictne', 'idle'),   # stale state of a left scene
            *m.flag(st, 'inflight', 'if1'), ('iftrue', 'drop'),
            ('label', 'idle'),
            *effective('e1', True),
            g(items), ('iffalse', 'none'), g(items), m.gp('length'), ('pushbyte', 0), ('ifgt', 'some'),
            ('label', 'none'), *m.instant(this, [m.s(TEXT['none'])]), ('returnvoid',),
            ('label', 'some'),
            g(ctx), *m.set('c23_batch', [m.s('scene'), ('getlocal_0',), m.s('items'), g(items),
                                         m.s('count'), g(items), m.gp('length'), m.s('total'), g(total),
                                         m.s('inflight'), ('pushfalse',), ('newobject', 5)]),
            m.s(TEXT['confirm_batch_a']), g(items), m.gp('length'), ('add',), m.s(TEXT['confirm_batch_b']), ('add',),
            g(total), ('add',), p(msg),
            ('getlocal_0',), *m.confirm_dialog([g(msg)], this, B_SEND), ('callpropvoid', qq('openDialog'), 1),
            ('returnvoid',),
            ('label', 'k_send'), ('getlocal_1',), m.n(B_SEND), ('ifne', 'k_row'),
            *m.ctx(ctx, scr, 'drop'), *m.has([g(ctx)], 'c23_batch', 'drop'), g(ctx), *m.get('c23_batch'),
            ('coerce_a',), p(st), g(st), ('iffalse', 'drop'),
            g(st), *m.get('scene'), ('getlocal_0',), ('ifstrictne', 'drop'),
            *m.flag(st, 'inflight', 'if2'), ('iftrue', 'drop'),
            ('getlocal_0',), ('callproperty', qq('isAliveScene'), 0), ('iffalse', 'drop'),
            *mode_flags(m, riven, batch, scr, 'm4'), g(batch), ('iffalse', 'send_stale'),
            *m.rivens(riv, 'send_stale'), g(st), *m.get('items'), ('coerce_a',), p(items),
            ('pushbyte', 0), p(i),
            ('label', 'vloop'), ('avm_label',), g(i), g(items), m.gp('length'), ('ifge', 'verified'),
            g(items), g(i), ('getproperty', 14), ('coerce_a',), p(item),
            g(item), *m.get('item_id'), ('convert_i',), p(ident), *m.record(riv, ident, rec, 'send_stale'),
            g(rec), *m.get('revision'), ('convert_i',), g(item), *m.get('revision'), ('ifne', 'send_stale'),
            *m.blocked(rec, lk, pd, 'vb'), g(lk), ('iftrue', 'send_stale'), g(pd), ('iftrue', 'send_stale'),
            ('inclocal_i', i), ('jump', 'vloop'),
            ('label', 'verified'),
            g(st), *m.set('inflight', [('pushtrue',)]),
            *m.remote(this, 'weapon_riven/dismantle_batch', [m.s('items'), g(items), ('newobject', 1)],
                      [('getlocal_0',), m.gp('filterDialogOkHandler')]),
            ('returnvoid',),
            ('label', 'send_stale'), g(ctx), *m.set('c23_batch', [('pushnull',)]),
            ('label', 'changed'), ('avm_label',), *m.instant(this, [m.s(TEXT['changed'])]), *prune_refresh(m, L, 'pr1'),
            ('returnvoid',),
            # row toggle in batch mode (riven rows only); otherwise fall through to C3 (opens detail)
            ('label', 'k_row'), ('getlocal_1',), m.n(ROW + LOWER), ('iflt', 'original'),
            ('getlocal_1',), m.n(ROW + UPPER), ('ifgt', 'original'),
            *mode_flags(m, riven, batch, scr, 'm5'), g(batch), ('iffalse', 'original'),
            *selected(m, sel, 'drop'),
            g(sel), ('getlocal_1',), index_of, p(pos), g(pos), ('pushbyte', 0), ('iflt', 'add'),
            g(sel), g(pos), ('pushbyte', 1), ('callpropvoid', qq('http://adobe.com/AS3/2006/builtin::splice'), 2),
            ('getlocal_0',), m.gp('viewSceneOrder'), ('getlocal_1',), ('pushfalse',), ('callpropvoid', upd, 2),
            ('returnvoid',),
            ('label', 'add'), ('getlocal_1',), m.n(0xFFFFFF), ('bitand',), p(ident),
            *m.rivens(riv, 'changed'), *m.record(riv, ident, rec, 'changed'),
            *m.blocked(rec, lk, pd, 'rb'),
            g(lk), ('iffalse', 'r_unlocked'), *m.instant(this, [m.s(TEXT['locked'])]), ('returnvoid',),
            ('label', 'r_unlocked'), g(pd), ('iffalse', 'r_free'), *m.instant(this, [m.s(TEXT['pending'])]),
            ('returnvoid',),
            ('label', 'r_free'), *effective('e2', False), g(count), m.n(CAP), ('iflt', 'r_add'),
            *m.instant(this, [m.s(TEXT['cap'])]), ('returnvoid',),
            ('label', 'r_add'), *selected(m, sel, 'drop'), g(sel), ('getlocal_1',), push,
            ('getlocal_0',), m.gp('viewSceneOrder'), ('getlocal_1',), ('pushtrue',), ('callpropvoid', upd, 2),
            ('label', 'drop'), ('returnvoid',), ('label', 'original')]
    q.add('batch', label, 2, code, asm.FORBID, '批量分解 buttons, confirm/send, row multi-select')
    return {'method': label, 'at': 2}


def queue_response(q):
    e = q.e
    label = 'EquipmentListScene/filterDialogOkHandler'
    ops = ops_of(e, label)
    assert [o.name for o in ops[:2]] == ['getlocal_0', 'pushscope']
    m = Emit(e, label, 30)
    names = 'ctx scr st data rows i row total msg sel riv ident rec lk pd key'.split()
    L = dict(zip(names, m.locals(len(names))))
    ctx, scr, st, data, rows, i, row, total, msg = (L[k] for k in 'ctx scr st data rows i row total msg'.split())
    qq = m.q
    this = [('getlocal_0',)]
    code = [('getlocal_1',), ('istype', qq('pinball.remote.common::ResponseData')), ('iffalse', 'original'),
            *m.ctx(ctx, scr, 'drop'), *m.has([g(ctx)], 'c23_batch', 'drop'), g(ctx), *m.get('c23_batch'),
            ('coerce_a',), p(st), g(st), ('iffalse', 'drop'),
            g(st), *m.get('scene'), ('getlocal_0',), ('ifstrictne', 'drop'),
            *m.flag(st, 'inflight', 'inf'), ('iffalse', 'drop'),
            g(st), *m.set('inflight', [('pushfalse',)]), g(ctx), *m.set('c23_batch', [('pushnull',)]),
            ('getlocal_0',), ('callproperty', qq('isAliveScene'), 0), ('iffalse', 'drop'),
            ('getlocal_1',), m.gp('rawData'), ('coerce_a',), p(data), g(data), ('iffalse', 'drop'),
            *m.has([g(data)], 'data', 'drop'), g(data), *m.get('data'), ('coerce_a',), p(data), g(data), ('iffalse', 'drop'),
            *m.flag(data, 'weapon_riven_conflict', 'cf'), ('iffalse', 'success'),
            *m.instant(this, [m.s(TEXT['changed'])]), *prune_refresh(m, L, 'pr'), ('returnvoid',),
            ('label', 'success'), ('pushbyte', 0), p(total),
            *m.has([g(data)], 'dismantle_return_total', 'summed'), g(data), *m.get('dismantle_return_total'),
            ('coerce_a',), p(rows), g(rows), ('iffalse', 'summed'), ('pushbyte', 0), p(i),
            ('label', 'sloop'), ('avm_label',), g(i), g(rows), m.gp('length'), ('ifge', 'summed'),
            g(rows), g(i), ('getproperty', 14), ('coerce_a',), p(row), g(row), ('iffalse', 'snext'),
            g(row), ('pushbyte', 0), ('getproperty', 14), ('convert_i',), m.n(FRAGMENT), ('ifne', 'snext'),
            g(total), g(row), ('pushbyte', 1), ('getproperty', 14), ('convert_i',), ('add',), ('convert_i',), p(total),
            ('label', 'snext'), ('inclocal_i', i), ('jump', 'sloop'),
            ('label', 'summed'),
            ('getlocal_0',), m.gp('bulkSelector'), ('callpropvoid', qq('deselectAll'), 0),
            ('getlocal_0',), ('getlex', qq(STATUS)), m.gp('Normal'), ('setproperty', qq('checkButtonStatus')),
            *refresh(m),
            m.s(TEXT['done_batch_a']), g(st), *m.get('count'), ('convert_i',), ('add',), p(msg),
            g(total), ('pushbyte', 0), ('ifgt', 'gain'), g(msg), m.s(TEXT['done_batch_plain']), ('add',), p(msg),
            ('jump', 'show'), ('label', 'gain'), g(msg), m.s(TEXT['done_batch_b']), ('add',), g(total), ('add',), p(msg),
            ('label', 'show'), ('getlocal_0',), *m.ok_dialog([g(msg)]), ('callpropvoid', qq('openDialog'), 1),
            ('label', 'drop'), ('returnvoid',), ('label', 'original')]
    q.add('batch', label, 2, code, asm.FORBID, 'dismantle_batch response (ResponseData never reaches native filter code)')
    return {'method': label, 'at': 2}


def queue_thumbnail(q):
    e = q.e
    label = 'EquipmentListScene/toThumbnailData'
    ops = ops_of(e, label)
    hits = [i for i in range(1, len(ops) - 1) if ops[i].name == 'pushfalse' and ops[i - 1].name == 'pushstring'
            and e.abc.s(ops[i - 1].args[0]) == 'selected' and ops[i + 1].name == 'newobject' and ops[i + 1].args == [7]]
    assert len(hits) == 1, hits
    at = hits[0] + 1
    m = Emit(e, label, 2)
    t = m.local()
    code = [('pop',), *m.has([('getlocal_0',)], 'bulkSelector', 'nf'), ('getlocal_0',), m.gp('bulkSelector'),
            ('coerce_a',), p(t), g(t), ('iffalse', 'nf'), g(t), ('getlocal_1',), ('callproperty', m.q('isSelecting'), 1),
            ('convert_b',), ('jump', 'end'), ('label', 'nf'), ('pushfalse',), ('label', 'end')]
    q.add('batch', label, at, code, asm.FORBID, 'riven DTO selected = bulkSelector.isSelecting(row key)')
    return {'method': label, 'at': at}


def queue_row_views(q):
    e = q.e
    result = {}
    label = 'EquipmentListTableItemView/setSelected'
    ops = ops_of(e, label)
    assert [o.name for o in ops[:3]] == ['getlocal_0', 'pushscope', 'getlocal_0']
    m = Emit(e, label, 2)
    it = m.local()
    code = [('getlocal_0',), m.gp('item'), ('coerce_a',), p(it), g(it), ('iffalse', 'original'),
            *m.flag(it, 'wfxRiven', 'rv'), ('iffalse', 'original'),
            ('getlocal_0',), m.gp('layout'), ('iftrue', 'live'),
            g(it), *m.set('selected', [('getlocal_1',)]), ('returnvoid',),
            ('label', 'live'), ('getlocal_0',), m.gp('itemSelected'), ('getlocal_1',), ('ifeq', 'done'),
            ('getlocal_0',), ('getlocal_1',), ('setproperty', m.q('itemSelected')),
            ('getlocal_0',), m.gp('thumbnailView'), ('getlocal_1',), ('callpropvoid', m.q('select'), 1),
            ('label', 'done'), ('returnvoid',), ('label', 'original')]
    q.add('batch', label, 2, code, asm.FORBID, 'riven rows: native check mark via ItemThumbnailView.select')
    result[label] = 2
    label = 'EquipmentListTableItemView/apply'
    ops = ops_of(e, label)
    hits = [i for i in range(3, len(ops)) if ops[i].name == 'callpropvoid' and mn(e, ops[i]) == 'select'
            and ops[i - 1].name == 'pushfalse' and ops[i - 2].name == 'getproperty' and mn(e, ops[i - 2]) == 'thumbnailView']
    assert len(hits) == 1, hits
    m = Emit(e, label, 2)
    t = m.local()
    code = [('pop',), *m.flag(1, 'selected', 'sl'), p(t), ('getlocal_0',), g(t), ('setproperty', m.q('itemSelected')), g(t)]
    q.add('batch', label, hits[0], code, asm.FORBID, 'C3 riven apply: select(DTO.selected) instead of false')
    result[label] = hits[0]
    label = 'EquipmentListTableItemView/enhancedEffectAnimationDraw'
    ops = ops_of(e, label)
    assert ops[-1].name == 'returnvoid'
    m = Emit(e, label, 12)
    tv, layer, dim, want, it, ctx, scr, riv, ident, rec, lk, pd = m.locals(12)
    qq = m.q
    code = [*m.has([('getlocal_0',)], 'thumbnailView', 'done'), ('getlocal_0',), m.gp('thumbnailView'), ('coerce_a',), p(tv),
            g(tv), ('iffalse', 'done'), g(tv), m.gp('layer'), ('coerce_a',), p(layer), g(layer), ('iffalse', 'done'),
            g(layer), m.s(DIM_NAME), ('callproperty', qq('getChildByName'), 1), ('coerce_a',), p(dim),
            ('pushfalse',), p(want),
            ('getlocal_0',), m.gp('layout'), ('iffalse', 'apply'),
            ('getlocal_0',), m.gp('item'), ('coerce_a',), p(it), g(it), ('iffalse', 'apply'),
            *m.flag(it, 'wfxRiven', 'rv'), ('iffalse', 'apply'),
            *m.ctx(ctx, scr, 'apply'), *m.flag(ctx, 'c23_batch_on', 'on'), ('iffalse', 'apply'),
            *m.has([g(it)], 'item_id', 'apply'), g(it), *m.get('item_id'), ('convert_i',), p(ident),
            *m.rivens(riv, 'apply'), *m.record(riv, ident, rec, 'apply'),
            *m.blocked(rec, lk, pd, 'bk'), g(lk), g(pd), ('bitor',), ('convert_b',), p(want),
            ('label', 'apply'),
            g(dim), ('iftrue', 'have'), g(want), ('iffalse', 'done'),
            ('getlex', qq('pinball.ui.display::QuadTools')), m.n(168), m.n(168), m.n(0), m.n(11), m.n(20), ('divide',),
            ('callproperty', qq('create'), 4), ('coerce_a',), p(dim),
            g(dim), m.s(DIM_NAME), ('setproperty', qq('name')), g(dim), ('pushfalse',), ('setproperty', qq('touchable')),
            g(dim), m.n(-84), ('setproperty', qq('x')), g(dim), m.n(-84), ('setproperty', qq('y')),
            g(layer), g(dim), ('callpropvoid', qq('addChild'), 1),
            ('label', 'have'), g(dim), m.gp('visible'), g(want), ('ifeq', 'done'),
            g(dim), g(want), ('setproperty', qq('visible')),
            ('label', 'done')]
    q.add('batch', label, len(ops) - 1, code, asm.ENTER, 'batch mode: dim locked / pending-draw rows (overlay quad)')
    result[label] = len(ops) - 1
    return result


def queue_batch(q):
    return {'run_ids': queue_run_ids(q), 'footer': queue_footer(q), 'update': queue_update(q),
            'click': queue_click(q), 'response': queue_response(q), 'thumbnail': queue_thumbnail(q),
            'rows': queue_row_views(q)}
