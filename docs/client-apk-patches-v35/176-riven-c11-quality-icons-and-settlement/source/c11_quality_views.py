"""Title/list presentation hooks; original name text and native nodes are reused."""
import asm
from c1_lookup import number
from c2_common import get, queue
from c9_lists import current_lookup
from c11_quality_tokens import suffix, paint


def soul_name(e, info, first):
    ident, scratch, record = first, first + 1, first + 2
    return [('getlocal', info), ('getproperty', e.q('itemId')), ('setlocal', ident),
            *current_lookup(e, ident, scratch, record, 'c11_soul_plain'),
            *suffix(e, [('getlocal', record), *get(e, 'disposition')], first + 3, 'c11_soul'),
            ('label', 'c11_soul_plain'),
            *paint(e, first + 4, 'c11_soul_color', native=False, default=0x333333)]


def queue_views(e):
    result = {}
    label = 'EquipmentListTableItemView/apply'
    body = e.body(label); ops = asm.decode(body[5]); first = body[2]
    at = next(i for i, op in enumerate(ops) if op.name == 'callpropvoid'
              and e.abc.mn_name(op.args[0]) == 'set_text')
    code = suffix(e, [('getlocal_1',), *get(e, 'record'), *get(e, 'disposition')],
                  first, 'c11_weapon') + paint(e, first + 1, 'c11_weapon_color')
    result[label] = {'name': queue(e, label, code, at, asm.SKIP)}
    # The native row uses lv_text as the parent of awakening graphics and never
    # assigns a level string. Clear our previous name only when recycling a
    # riven row; the native layout's empty text and 0x444444 color are restored.
    ordinary = next(i for i in range(at + 1, len(ops)) if ops[i].name == 'returnvoid') + 1
    reset = [('getlocal_0',), ('getproperty', e.q('layout')), ('iffalse', 'c11_reset_done'),
             ('getlocal_0',), ('getproperty', e.q('item')), ('iffalse', 'c11_reset_done'),
             ('getlocal_0',), ('getproperty', e.q('item')), *get(e, 'wfxRiven'),
             ('iffalse', 'c11_reset_done'),
             ('getlocal_0',), ('getproperty', e.q('layout')), e.string('lv_text'),
             ('pushnull',), ('callproperty', e.q('getText'), 2),
             ('dup',), e.string(''), ('callpropvoid', e.q('set_text'), 1),
             ('callproperty', e.q('get_format'), 0), number(e, 0x444444),
             ('setproperty', e.q('color'))]
    # C3 wrote the native widgets directly without invalidating their previous
    # ordinary-equipment cache. Force exactly one native refresh on the return
    # transition, preserving the existing levelView and its Gear ownership.
    for field in ('equipmentPixelArtPath', 'equipmentRarity', 'equipmentKind', 'label'):
        reset += [('getlocal_0',), ('getlex', e.q('haxe.ds::Option')),
                  ('getproperty', e.q('None')), ('setproperty', e.q(field))]
    for field in ('equipmentStack', 'level', 'hp', 'attack'):
        reset += [('getlocal_0',), number(e, 1), ('negate_i',), ('setproperty', e.q(field))]
    reset += [('getlocal_0',), ('getlocal_1',), *get(e, 'selected'), ('not',),
              ('setproperty', e.q('itemSelected')),
              ('getlocal_0',), ('getlocal_1',), ('setproperty', e.q('item')),
              ('label', 'c11_reset_done')]
    result[label]['native_reset'] = queue(e, label, reset, ordinary)
    for label, info in [('PanelInnerContentItemListTableView/draw', 5),
                        ('PanelInnerContentItemListTableView/apply', 14)]:
        body = e.body(label); ops = asm.decode(body[5])
        at = next(i for i, op in enumerate(ops) if op.name == 'setproperty'
                  and e.abc.mn_name(op.args[0]) == 'text')
        result[label] = queue(e, label, soul_name(e, info, body[2]), at, asm.SKIP)
    for label, marker, default in [
            ('ExBoostWindowView/onApplyExBoostInformation', 'characterName', 0x444444),
            ('ExBoostWindowView/setupExBoostInformationWindow', 'characterName', 0x444444),
            ('ExBoostSelectDialogView/run', 'getExBoostCharacterName', 0xFAFAFA)]:
        body = e.body(label); ops = asm.decode(body[5])
        hits = [i for i, op in enumerate(ops) if
                (op.name == 'pushstring' and e.abc.s(op.args[0]) == marker) or
                (op.name == 'callproperty' and e.abc.mn_name(op.args[0]).endswith('::' + marker))]
        result[label] = []
        assert hits, (label, marker)
        for count, hit in enumerate(hits):
            at = next(i for i in range(hit, len(ops)) if ops[i].name == 'callpropvoid'
                      and e.abc.mn_name(ops[i].args[0]) == 'set_text')
            result[label].append(queue(e, label, paint(e, body[2], 'c11_title_' + str(count),
                                                       default=default), at, asm.SKIP))
    label = 'DialogItemTitleView/run'
    body = e.body(label); ops = asm.decode(body[5])
    at = next(i for i, op in enumerate(ops) if op.name == 'callpropvoid'
              and e.abc.mn_name(op.args[0]) == 'set_text')
    result[label] = queue(e, label, paint(e, body[2], 'c11_detail_title'), at, asm.SKIP)
    return result
