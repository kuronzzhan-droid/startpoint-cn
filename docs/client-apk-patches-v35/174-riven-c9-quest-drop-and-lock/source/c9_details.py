"""C9 display-only cap readback; battle scaling keeps the original level."""
import asm
from c1_lookup import number, lookup
from c2_common import DYNAMIC, get, queue


def cap_suffix(e, term, first, assets, tag):
    """Preserve the current description on stack; append cap from game formatting."""
    current, cap, matches, expression = range(first, first + 4)
    g = lambda n: ('getlocal', n)
    q = e.q
    code = [('setlocal', current), g(term), ('getproperty', q('length')),
            number(e, 3), ('iflt', tag + '_plain'), g(term), number(e, 2),
            ('getproperty', DYNAMIC), ('convert_i',), ('setlocal', cap),
            g(cap), number(e, 1), ('iflt', tag + '_plain'),
            g(cap), number(e, 100), ('ifgt', tag + '_plain'),
            ('getlex', q('pinball.common.data.ability::AbilitySoulAbilityLogic')),
            number(e, 31), g(term), number(e, 0), ('getproperty', DYNAMIC),
            ('convert_i',), ('getlex', q('pinball.common.data.ability::AbilityPowerValueCalculateMethod')),
            g(cap), number(e, 1), number(e, 100), ('callproperty', q('MinToMaxLevelScale'), 3),
            ('pushfalse',), *assets, ('construct', 5),
            ('callproperty', q('getDescriptions'), 0), e.string('\n'),
            ('callproperty', q('http://adobe.com/AS3/2006/builtin::join'), 1), ('setlocal', cap),
            ('getlex', q('RegExp')), e.string('[+\\-\\u2212]?[0-9]+(?:\\.[0-9]+)?[%\\uff05]'),
            e.string('g'), ('construct', 2), ('setlocal', expression),
            g(expression), g(cap), ('callproperty', q('http://adobe.com/AS3/2006/builtin::exec'), 1),
            ('setlocal', matches),
            g(matches), ('iffalse', tag + '_full'),
            g(expression), g(cap), ('callproperty', q('http://adobe.com/AS3/2006/builtin::exec'), 1),
            ('iftrue', tag + '_full'),
            g(matches), number(e, 0), ('getproperty', DYNAMIC), ('setlocal', cap),
            ('label', tag + '_full'), g(current), e.string('（满档 '), ('add',),
            g(cap), ('add',), e.string('）'), ('add',), ('jump', tag + '_done'),
            ('label', tag + '_plain'), g(current), ('label', tag + '_done')]
    return code


def disposition(e, record, tag):
    return [('getlocal', record), *get(e, 'disposition'), ('iffalse', tag + '_done'),
            e.string(' · 倾向 '), ('add',), ('getlocal', record), *get(e, 'disposition'),
            ('convert_i',), ('add',), ('label', tag + '_done')]


def queue_details(e):
    result = {}
    for label in ('ExBoostWindow/getExBoostInformation', 'ExBoostWindow/getExBoostDetail',
                  'AbilitySoulDetailDialog/initialize'):
        ops = asm.decode(e.body(label)[5])
        # C8 places the plain joined description into a scratch local immediately
        # before its explicit polarity wrapper. Insert before that wrapper so
        # negative cap text is contained in the same red font span.
        points = [i for i,o in enumerate(ops) if o.name == 'callproperty'
                  and e.abc.mn_name(o.args[0]).endswith('::join')
                  and i+1 < len(ops) and ops[i+1].name == 'setlocal']
        assert len(points) == 1, (label, points)
        at = points[0] + 1
        scale = max(i for i in range(at) if ops[i].name == 'callproperty'
                    and e.abc.mn_name(ops[i].args[0]) == 'MinToMaxLevelScale')
        assert ops[scale-6].name == 'getlocal'
        term = ops[scale-6].args[0]
        assets = ([('getlocal_1',), ('getproperty', e.q('logicAssets'))]
                  if label.startswith('AbilitySoul') else
                  [('getlocal_0',), ('getproperty', e.q('logicAsset'))])
        result[label] = {'caps': queue(e, label, cap_suffix(e, term, e.body(label)[2], assets, 'c9_cap'), at)}
    label = 'ExBoostWindow/getExBoostInformation'
    ops = asm.decode(e.body(label)[5])
    at = next(i for i,o in enumerate(ops) if o.name == 'pushstring' and e.abc.s(o.args[0]) == '裂罅') + 2
    record = next(ops[i-1].args[0] for i,o in enumerate(ops[:at])
                  if o.name == 'pushstring' and e.abc.s(o.args[0]) == 'weapon_id')
    result[label]['disposition'] = queue(e, label, disposition(e, record, 'c9_page_tendency'), at)
    label = 'AbilitySoulDetailDialog/initialize'
    first = e.body(label)[2]
    code = [('getlocal_1',), ('getproperty', e.q('id')), ('setlocal', first)]
    find = lookup(e, first, first+1, first+2, 'c9_title_done')
    find = [number(e, 16000999) if op == number(e,16000200) else op for op in find]
    code += find + disposition(e, first+2, 'c9_detail_tendency') + [('label','c9_title_done')]
    # The original item name is still on stack before ItemTitle.
    result[label]['disposition'] = queue(e, label, code, 11)
    return {'methods':result, 'cap_source':'AbilitySoulAbilityLogic(MinToMaxLevelScale(cap_L,1,100)).getDescriptions',
            'legacy_pair':'no cap suffix', 'negative':'entire current and cap description retain C8 red wrapper'}
