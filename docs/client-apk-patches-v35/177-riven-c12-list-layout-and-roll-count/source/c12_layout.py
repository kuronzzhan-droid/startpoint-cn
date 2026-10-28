"""C12 entry point: queue reversible display-only method splices."""
import asm
from c1_lookup import number
from c2_common import get, queue
from c11_quality_tokens import normalized
from c12_layout_text import g, read, write, raw, plain, fit, quality


def field(e, name):
    return [('getlocal_0',), ('getproperty', e.q('layout')), e.string(name),
            ('pushnull',), ('callproperty', e.q('getText'), 2)]


def weapon(e):
    label = 'EquipmentListTableItemView/apply'; body = e.body(label)
    ops = asm.decode(body[5]); first = body[2] + 20
    node, value, grade, style = range(first, first + 4)
    at = next(i for i, op in enumerate(ops) if op.name == 'callpropvoid'
              and e.abc.mn_name(op.args[0]) == 'set_text')
    code = [('pop',), ('setlocal', node), ('getlocal_1',), *get(e, 'name'), ('setlocal', value),
            *field(e, 'hp_text'), ('callproperty', e.q('get_format'), 0), ('setlocal', style),
            *plain(e, node, True, 0x444444), *read(e, node, 'format', True), g(style),
            ('getproperty', e.q('size')), ('setproperty', e.q('size')),
            *fit(e, node, value, first + 4, 'c12_weapon_fit'), g(node), g(value)]
    result = {'name': queue(e, label, code, at, asm.SKIP)}
    # Original C3 set_autoScale(true) follows its name assignment.
    auto = next(i for i in range(at + 1, len(ops)) if ops[i].name == 'callpropvoid'
                and e.abc.mn_name(ops[i].args[0]) == 'set_autoScale')
    result['fixed_name_size'] = queue(e, label, [('pop',), ('pushfalse',)], auto, asm.SKIP)
    texts = [i for i in range(auto + 1, len(ops)) if ops[i].name == 'callpropvoid'
             and e.abc.mn_name(ops[i].args[0]) == 'set_text'][:2]
    # Keep existing y positions: hp becomes quality and attack becomes affixes.
    code = [('pop',), ('setlocal', node), ('getlocal_1',), *get(e, 'record'), *get(e, 'disposition'),
            *normalized(e, grade, 'c12_weapon_grade'), ('setlocal', grade),
            *plain(e, node, True, 0x444444), *raw(e, node, True), ('pushtrue',),
            ('setproperty', e.q('isHtmlText')), g(node), *quality(e, grade)]
    result['quality'] = queue(e, label, code, texts[0], asm.SKIP)
    code = [('pop',), ('setlocal', node), *plain(e, node, True, 0x444444), g(node),
            e.string('词条 '), ('getlocal_1',), *get(e, 'record'), *get(e, 'affixes'),
            ('getproperty', e.q('length')), ('add',), e.string(' 条'), ('add',)]
    result['affixes_without_roll_line'] = queue(e, label, code, texts[1], asm.SKIP)
    # Restore only a riven-to-native transition, before C11 invalidates caches.
    ordinary = next(i for i in range(texts[1] + 1, len(ops)) if ops[i].name == 'returnvoid') + 1
    reset = [('getlocal_0',), ('getproperty', e.q('layout')), ('iffalse', 'c12_reset_done'),
             ('getlocal_0',), ('getproperty', e.q('item')), ('iffalse', 'c12_reset_done'),
             ('getlocal_0',), ('getproperty', e.q('item')), *get(e, 'wfxRiven'), ('iffalse', 'c12_reset_done')]
    for name in ('lv_text', 'hp_text', 'attack_text'):
        reset += [*field(e, name), ('setlocal', node), *plain(e, node, True, 0x444444),
                  *write(e, node, 'autoScale', [('pushtrue',)], True),
                  *raw(e, node, True), ('pushtrue',), ('setproperty', e.q('wordWrap'))]
    reset += [('label', 'c12_reset_done')]
    result['native_recycle'] = queue(e, label, reset, ordinary)
    return result


def apply(editor):
    from c12_layout_views import views
    return {'weapon': weapon(editor), 'views': views(editor),
            'name_font': 'Existing affix style; no autoScale; original font native width measurement',
            'quality': 'Five separated glyphs, solid native quality color, hollow #999999',
            'new_methods': 0, 'new_traits': 0, 'device_render_verified': False}
