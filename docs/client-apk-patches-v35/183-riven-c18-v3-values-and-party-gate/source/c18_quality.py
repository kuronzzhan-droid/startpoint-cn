"""Accept server grade zero and render five hollow dots by closed C17 splices."""
import asm
import bodies
from c1_lookup import number
from c2_common import queue
from c10_strings import TEXT

ZERO = '○○○○○'
INDEX_OF = 'http://adobe.com/AS3/2006/builtin::indexOf'
SUBSTR = 'http://adobe.com/AS3/2006/builtin::substr'


def g(local):
    return ('getlocal', local)


def capture(e, local):
    """Keep the original operand and distinguish numeric 0 from null/undefined."""
    return [('dup',), number(e, 0), ('strictequals',), ('setlocal', local)]


def replace_zero(e, local, zero):
    return [g(local), ('iffalse', 'c18_quality_keep'), ('pop',), e.string(zero),
            ('label', 'c18_quality_keep')]


def transport(e):
    result = {}
    for label in ('InitializeRealRemote/loadSuccessHandler', 'RealRemoteService/earlySuccessHandler'):
        ops = asm.decode(e.body(label)[5])
        sites = [i for i, op in enumerate(ops) if op.name == 'pushstring'
                 and e.abc.s(op.args[0]) == 'disposition' and ops[i + 2].name == 'setlocal']
        assert len(sites) == 1, (label, sites)
        at = sites[0] + 9
        assert ops[at - 1].name == 'pushbyte' and ops[at - 1].args == [1]
        assert ops[at].name == 'iflt'
        result[label] = queue(e, label, [('pop',), number(e, 0)], at, asm.SKIP)
    return result


def zero_text(value):
    """Retain C12/C13 authored sizes, spacing and label; gray every hollow dot."""
    if value == TEXT['quality_1']:
        return ZERO
    import re
    result = value.replace('●', '○')
    return re.sub(r'(<font size="\d+" color=")#[0-9a-fA-F]+(">○</font>)',
                  r'\1#999999\2', result)


def recognize_zero(e, ops, at, flag):
    """Use the inherited multiline path with its same-width suffix delimiter.

    This modifies a scratch title only. The inherited path cuts the delimiter
    off, and the output splice replaces its quality row with five hollow dots.
    """
    assert ops[at - 1].name == 'getlocal'
    value, index = ops[at - 1].args[0], ops[at + 2].args[0]
    return [('pushfalse',), ('setlocal', flag), g(value),
            e.string(TEXT['quality'] + ZERO), ('callproperty', e.q(INDEX_OF), 1),
            ('setlocal', index), g(index), number(e, 0), ('iflt', 'c18_quality_plain'),
            ('pushtrue',), ('setlocal', flag), g(value), number(e, 0), g(index),
            ('callproperty', e.q(SUBSTR), 2),
            e.string(TEXT['quality'] + TEXT['quality_1']), ('add',), ('setlocal', value),
            ('label', 'c18_quality_plain')]


def displays(e):
    result = {}
    labels = bodies.label_map(e.abc)
    for index, body in enumerate(e.abc.bodies):
        label = labels.get(index, '')
        if not label.startswith(('EquipmentListTableItemView/', 'ExBoost', 'PanelInnerContent',
                                 'DialogItemTitleView/', 'AbilitySoulDetailDialog/')):
            continue
        ops = asm.decode(body[5])
        arrays = []
        for i, op in enumerate(ops):
            if op.name != 'newarray' or op.args != [5] or i < 5:
                continue
            literals = ops[i - 5:i]
            if not all(x.name == 'pushstring' for x in literals):
                continue
            strings = [e.abc.s(x.args[0]) for x in literals]
            if not all('●' in value for value in strings):
                continue
            end = next(j for j in range(i + 1, i + 50) if ops[j].name == 'subtract_i')
            assert ops[end - 2].name == 'getlocal' and ops[end + 1].name == 'getproperty'
            grade = ops[end - 2].args[0]
            arrays.append((i, end + 2, grade, zero_text(strings[0])))
        rows = []
        for ordinal, (array, after, grade, zero) in enumerate(arrays):
            flag = body[2] + 16 + ordinal
            # Direct numeric grade: exactly the inherited 1..5 clamp, which
            # stays untouched for icon frames and every nonzero/fallback value.
            clamps = [i for i in range(max(0, array - 100), after - 4)
                      if [o.name for o in ops[i:i + 5]] ==
                      ['convert_i', 'setlocal', 'getlocal', 'pushbyte', 'ifge']
                      and ops[i + 1].args == [grade] and ops[i + 3].args == [1]]
            if clamps:
                clamp = clamps[-1]
                source = clamp
                while source and ops[source - 1].name == 'convert_i':
                    source -= 1
                assert ops[source - 1].name == 'getproperty'
                assert ops[source - 2].name == 'pushstring'
                assert e.abc.s(ops[source - 2].args[0]) == 'disposition'
                start = queue(e, label, capture(e, flag), source, asm.SKIP)
                origin = 'strict numeric disposition == 0'
            else:
                matches = [i for i in range(array) if ops[i].name == 'pushstring'
                           and e.abc.s(ops[i].args[0]) == TEXT['quality'] + TEXT['quality_1']
                           and ops[i + 2].name == 'setlocal'
                           and ops[i + 7].name == 'setlocal' and ops[i + 7].args == [grade]]
                assert matches, (label, array, grade, 'missing inherited quality recognizer')
                at = matches[-1]
                start = queue(e, label, recognize_zero(e, ops, at, flag), at - 1)
                origin = 'owned title exact five-hollow suffix'
            finish = queue(e, label, replace_zero(e, flag, zero), after, asm.SKIP)
            rows.append({'array': array, 'source': origin, 'capture': start, 'output': finish,
                         'zero_text': zero})
        if rows:
            result[label] = rows
    assert sum(map(len, result.values())) == 17, [(k, len(v)) for k, v in result.items()]
    return result


def apply(editor):
    result = {'transport': transport(editor), 'displays': displays(editor),
              'wire_range': [0, 5], 'zero': ZERO, 'zero_is_explicit_numeric_zero': True,
              'nonzero_and_missing_behavior_retained': True,
              'thumbnail_frame_range_retained': [1, 5], 'new_art_assets': 0}
    assert not editor.new_methods and not editor.traits
    return result
