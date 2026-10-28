"""Per-affix presentation markup using the locked catalog's explicit polarity."""
import json
import asm
from bootstrap import sha, ROOT, write_json
from c3_filter_engine import CATALOG, LOCK
from c1_lookup import number, lookup
from c2_common import DYNAMIC, get, dtos, queue

RED_OPEN = '<font color="#ea354c">'
RED_CLOSE = '</font>'
CATALOG_SHA = 'ff5322771f676a3d274c702ced39462fa71ee513c861be9a026414cad9e6e351'
LOCK_SHA = '1ad59118b10815ef349e1f4ea4340cf88dd4c2d3a29db82da9405d40b0399550'


def negative_keys():
    raw, locked = CATALOG.read_bytes(), LOCK.read_bytes()
    assert sha(raw) == CATALOG_SHA and sha(locked) == LOCK_SHA
    rows, keys = json.loads(raw)['affixes'], json.loads(locked)['entries']
    for row in rows:
        assert keys[row['id']]['key'] == row['key']
        assert keys[row['id']]['definition']['polarity'] == row['polarity']
    result = [int(row['key']) for row in rows if row['polarity'] == '-']
    assert {15990001,15990003,15990005,15990008,15990010,15990015,15990018}.issubset(result)
    return result


def color_description(e, term, temp, tag):
    """Top of stack is the complete localized string, term is [key, level]."""
    code = [('setlocal', temp)]
    for key in negative_keys():
        code += [('getlocal', term), number(e, 0), ('getproperty', DYNAMIC),
                 number(e, key), ('ifeq', tag + '_red')]
    return code + [('getlocal', temp), ('jump', tag + '_done'),
                   ('label', tag + '_red'), e.string(RED_OPEN), ('getlocal', temp),
                   ('add',), e.string(RED_CLOSE), ('add',), ('label', tag + '_done')]


def detail_descriptions(e, first):
    ident, scratch, record, affixes, rows, index, result = range(first, first + 7)
    code = [('getlocal_1',), ('getproperty', e.q('id')), ('setlocal', ident)]
    # C8 emits its own complete 999-slot range; it does not reuse C1's old 200 bound.
    find = lookup(e, ident, scratch, record, 'c8_detail_done')
    old = number(e, 16000200)
    find = [number(e, 16000999) if op == old else op for op in find]
    code += find + [('getlocal', record), *get(e, 'affixes'), ('setlocal', affixes)]
    emitted = dtos(e, affixes, rows, first + 7,
                   [('getlocal_1',), ('getproperty', e.q('logicAssets'))], tag='c8_detail_dto')
    point = next(i for i, op in enumerate(emitted) if op == ('newobject', 3))
    emitted[point:point] = color_description(e, first + 8, first + 10, 'c8_detail_color')
    code += emitted + [('newarray', 0), ('setlocal', result), number(e, 0), ('setlocal', index),
                       ('label', 'c8_detail_loop'), ('avm_label',), ('getlocal', index),
                       ('getlocal', rows), ('getproperty', e.q('length')), ('ifge', 'c8_detail_end'),
                       ('getlocal', result), ('getlocal', rows), ('getlocal', index),
                       ('getproperty', DYNAMIC), *get(e, 'description'),
                       ('callpropvoid', e.q('http://adobe.com/AS3/2006/builtin::push'), 1),
                       ('inclocal_i', index), ('jump', 'c8_detail_loop'),
                       ('label', 'c8_detail_end'), ('getlocal', result), ('setlocal', 7),
                       ('label', 'c8_detail_done')]
    return code


def queue_colors(e):
    result = {}
    for label in ('ExBoostWindow/getExBoostInformation', 'ExBoostWindow/getExBoostDetail'):
        ops = asm.decode(e.body(label)[5])
        points = [i for i, op in enumerate(ops) if op.name == 'newobject' and op.args == [3]]
        # The single DTO object is immediately after description Array.join.
        points = [i for i in points if ops[i-1].name == 'callproperty'
                  and e.abc.mn_name(ops[i-1].args[0]).endswith('::join')]
        assert len(points) == 1, (label, points)
        at = points[0]
        scale = max(i for i in range(at) if ops[i].name == 'callproperty'
                    and e.abc.mn_name(ops[i].args[0]) == 'MinToMaxLevelScale')
        assert ops[scale-6].name == 'getlocal'
        term = ops[scale-6].args[0]
        result[label] = queue(e, label, color_description(e, term, e.body(label)[2], 'c8_dto'), at)
    label = 'ExBoostInformationAbilityView/applyExAbility'
    ops = asm.decode(e.body(label)[5])
    description = next(i for i,o in enumerate(ops) if o.name == 'pushstring'
                       and e.abc.s(o.args[0]) == 'description')
    target = next(i for i in range(description, len(ops)) if ops[i].name == 'callproperty'
                  and e.abc.mn_name(ops[i].args[0]) == 'getText')
    result[label] = queue(e, label, [('dup',), ('callpropvoid', e.q('enableHtmlText'), 0)], target+1)
    # Original EX uses the same recycled text node; disable HTML again on its branch.
    fallthrough = next(i for i,o in enumerate(ops) if o.name == 'returnvoid') + 1
    from c2_page_view import ui
    reset = ui(e, [('getlocal_0',), ('getproperty', e.q('layout'))], [], 'description')
    reset += [('callpropvoid', e.q('disableHtmlText'), 0)]
    result[label]['ordinary_reset'] = queue(e, label, reset, fallthrough)
    label = 'ExBoostDetailView/createText'
    code = [('getlocal_1',), e.string(RED_OPEN),
            ('callproperty', e.q('http://adobe.com/AS3/2006/builtin::indexOf'), 1),
            number(e, 0), ('iflt', 'c8_select_plain'),
            ('getlocal_3',), ('callpropvoid', e.q('enableHtmlText'), 0),
            ('label', 'c8_select_plain')]
    result[label] = queue(e, label, code, 23)
    label = 'AbilitySoulDetailDialog/initialize'
    result[label] = queue(e, label, detail_descriptions(e, e.body(label)[2]), 33)
    # The detail dialog need not be entered from the reroll page, so use the
    # existing description markup, not the global reroll scene context.
    label = 'DialogAbilitySoulDetailView/run'
    ops = asm.decode(e.body(label)[5])
    matches = [i for i,o in enumerate(ops) if o.name == 'findproperty'
               and e.abc.mn_name(o.args[0]) == 'descriptions']
    assert len(matches) == 1
    code = [('getlocal_0',), ('getproperty', e.q('descriptions')), e.string('\n'),
            ('callproperty', e.q('http://adobe.com/AS3/2006/builtin::join'), 1),
            e.string(RED_OPEN), ('callproperty', e.q('http://adobe.com/AS3/2006/builtin::indexOf'), 1),
            number(e, 0), ('iflt', 'c8_soul_plain'), ('dup',),
            ('callpropvoid', e.q('enableHtmlText'), 0), ('label', 'c8_soul_plain')]
    result[label] = queue(e, label, code, matches[0])
    write_json(ROOT / 'audit/c8-layout/polarity.json', {
        'catalog_sha256': CATALOG_SHA, 'lock_sha256': LOCK_SHA,
        'negative_keys': negative_keys(), 'red': '#ea354c',
        'red_source': 'ex_boost_panel.notify_no_ex_ability existing color',
        'positive_and_unknown': 'unwrapped original text; default normal color'})
    for path in (CATALOG, LOCK):
        (ROOT / 'audit/c8-layout' / path.name).write_bytes(path.read_bytes())
    return result
