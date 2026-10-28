"""C19 per-affix soul display arrays; native combat aggregation stays unchanged."""
import asm
from c1_lookup import number
from c2_common import DYNAMIC, dtos, get, queue
from c9_actions_lock import find_record
from c19_race import fold

UNKNOWN = '通关五重后揭示为武器裂罅'
METHODS = (
    'AbilitySoulUseDialog/getAbilitySoul',
    'AbilitySoulInUseDialog/getAbilitySoul',
    'AbilitySoulInUseDialog/getInUseAbilitySoul',
    'AbilitySoulReuseFromAnotherCharacterDialog/getRemoveAbilitySoul',
    'AbilitySoulReuseFromAnotherCharacterDialog/getInUseAbilitySoul',
    'AbilitySoulRemoveDialog/getWillRemoveAbilitySoul',
    'AbilitySoulSellDialog/initialize',
    'EquipmentUpgradeAbilitySoulGenerateResultDialog/initialize',
)


def color_description(e, term, temp, tag):
    """Read C18's existing polarity branches; the live generator is not an input."""
    ops = asm.decode(e.body('ExBoostWindow/getExBoostInformation')[5])
    red = next(i for i, op in enumerate(ops) if op.name == 'pushstring'
               and e.abc.s(op.args[0]) == '<font color="#ea354c">')
    keys = [e.abc.ints[ops[i - 1].args[0]] for i, op in enumerate(ops)
            if op.name == 'ifeq' and op.target == red and ops[i - 1].name == 'pushint']
    assert len(keys) == 12 and len(set(keys)) == len(keys), keys
    code = [('setlocal', temp)]
    for key in keys:
        code += [('getlocal', term), number(e, 0), ('getproperty', DYNAMIC),
                 number(e, key), ('ifeq', tag + '_red')]
    return code + [('getlocal', temp), ('jump', tag + '_done'),
                   ('label', tag + '_red'), e.string('<font color="#ea354c">'),
                   ('getlocal', temp), ('add',), e.string('</font>'), ('add',),
                   ('label', tag + '_done')]


def descriptions(e, soul, first, tag):
    """Replace only the native display Array, preserving ordinary soul results."""
    original, ident, scratch, record, affixes, rows, index, result = range(first, first + 8)
    g = lambda local: ('getlocal', local)
    p = lambda local: ('setlocal', local)
    n = lambda value: number(e, value)
    done, known, loop, end = (tag + suffix for suffix in ('_done', '_known', '_loop', '_end'))
    code = [p(original), g(soul), ('callproperty', e.q('get_abilitySoulId'), 0), p(ident),
            g(ident), n(16000000), ('ifne', known), e.string(UNKNOWN), ('newarray', 1),
            p(original), ('jump', done), ('label', known),
            g(ident), n(16000900), ('ifeq', done)]
    code += find_record(e, ident, scratch, record, done)
    code += [g(record), *get(e, 'affixes'), p(affixes), g(affixes),
             ('istype', e.q('Array')), ('iffalse', done), g(affixes),
             ('getproperty', e.q('length')), n(1), ('iflt', done)]
    emitted = dtos(e, affixes, rows, first + 8,
                   [g(soul), ('getproperty', e.q('logicAssets'))], tag=tag + '_dto')
    point = next(i for i, op in enumerate(emitted) if op == ('newobject', 3))
    term, ability = first + 9, first + 10
    emitted[point:point] = (fold(e, ability, first + 11, tag + '_race')
                           + color_description(e, term, first + 19, tag + '_color'))
    code += emitted + [('newarray', 0), p(result), n(0), p(index),
                       ('label', loop), ('avm_label',), g(index), g(rows),
                       ('getproperty', e.q('length')), ('ifge', end), g(result),
                       g(rows), g(index), ('getproperty', DYNAMIC), *get(e, 'description'),
                       ('callpropvoid', e.q('http://adobe.com/AS3/2006/builtin::push'), 1),
                       ('inclocal_i', index), ('jump', loop),
                       ('label', end), g(result), p(original), ('label', done), g(original)]
    return code


def apply(e):
    report = {}
    for method_index, label in enumerate(METHODS):
        body = e.body(label)
        ops = asm.decode(body[5])
        hits = [i for i, op in enumerate(ops[:-3]) if op.name == 'callproperty'
                and e.abc.mn_name(op.args[0]) == 'getAbility'
                and ops[i + 2].name == 'callproperty'
                and e.abc.mn_name(ops[i + 2].args[0]) == 'getDescriptions']
        assert len(hits) == 1, (label, hits)
        at, soul = hits[0], body[2]
        report[label] = {
            'capture': queue(e, label, [('dup',), ('setlocal', soul)], at, asm.SKIP),
            'descriptions': queue(e, label, descriptions(e, soul, soul + 1,
                'c19_soul_' + str(method_index)), at + 3, asm.SKIP),
        }
    label = 'AbilitySoulDetailDialog/initialize'
    ops = asm.decode(e.body(label)[5])
    old = '携带通关五重后揭示为武器裂罅'
    hits = [i for i, op in enumerate(ops) if op.name == 'pushstring'
            and e.abc.s(op.args[0]) == old]
    assert len(hits) == 1, hits
    report[label] = queue(e, label, [('pop',), e.string(UNKNOWN)], hits[0] + 1, asm.SKIP)
    label = 'DialogAbilitySoulDetailScrollableView/run'
    ops = asm.decode(e.body(label)[5])
    hits = [i for i, op in enumerate(ops) if op.name == 'findproperty'
            and e.abc.mn_name(op.args[0]) == 'descriptions']
    assert len(hits) == 1, hits
    code = [('getlocal_0',), ('getproperty', e.q('descriptions')), e.string('\n'),
            ('callproperty', e.q('http://adobe.com/AS3/2006/builtin::join'), 1),
            e.string('<font color="#ea354c">'),
            ('callproperty', e.q('http://adobe.com/AS3/2006/builtin::indexOf'), 1),
            number(e, 0), ('iflt', 'c19_soul_plain'), ('dup',),
            ('callpropvoid', e.q('enableHtmlText'), 0), ('label', 'c19_soul_plain')]
    report[label] = queue(e, label, code, hits[0], asm.SKIP)
    return {'methods': report, 'unknown': UNKNOWN,
            'scope': 'native soul display consumers only; no combat or shared ability changes',
            'line_breaks': 'one Array entry per affix, existing native line-spacing join',
            'polarity': 'C8 catalog negative red, positive original color',
            'main_marker': 'native per-affix description retains original position marker'}
