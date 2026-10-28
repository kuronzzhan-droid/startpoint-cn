"""A row marker limits single-column layout and wide labels to the soul riven page."""
import asm
from c1_lookup import number
from c2_common import DYNAMIC, OPTION, get, queue


def rows(e, first):
    from c8_soul import ROW
    q = e.q
    items, index, kind, layout = range(first, first + 4)
    g = lambda n: ('getlocal', n)
    return [('getlocal_0',), ('getproperty', q('items')), ('setlocal', items),
            number(e, 0), ('setlocal', index), ('label', 'loop'), ('avm_label',),
            g(index), g(items), ('getproperty', q('length')), ('ifge', 'done'),
            g(items), g(index), ('getproperty', DYNAMIC), ('getproperty', q('kind')),
            ('setlocal', kind), g(kind), ('getproperty', q('index')), number(e, 0), ('ifne', 'next'),
            g(kind), ('getproperty', q('params')), number(e, 0), ('getproperty', DYNAMIC),
            *get(e, ROW), ('iftrue', 'single'), ('label', 'next'), ('inclocal_i', index),
            ('jump', 'loop'), ('label', 'single'), ('getlocal_0',), ('getproperty', q('itemTable')),
            ('getproperty', q('thumbnailLayouter')), ('setlocal', layout),
            g(layout), ('getlex', q(OPTION)), number(e, 1), ('callproperty', q('Some'), 1),
            ('setproperty', q('maxColumns')), g(layout), number(e, 0), ('setproperty', q('baseX')),
            g(layout), ('getproperty', q('thumbnailRect')), ('getlocal_0',),
            ('getproperty', q('contentWidth')), ('setproperty', q('width')),
            g(layout), ('getproperty', q('thumbnailRect')), number(e, 168),
            ('setproperty', q('height')), ('label', 'done')]


def label(e, first):
    from c8_soul import ROW
    q = e.q
    code = [('getlocal', 5), *get(e, ROW), ('iffalse', 'done'), ('getlocal', 6),
            ('getproperty', q('layer')), e.string('wfx-riven-name'),
            ('callproperty', e.newq('getChildByName'), 1), ('setlocal', first),
            ('getlocal', first), ('iffalse', 'done')]
    for prop, value in [('x', [number(e, 120)]), ('y', [number(e, 30), ('negate',)]),
                        ('width', [('getlocal_0',), ('getproperty', q('contentWidth')),
                                   number(e, 220), ('subtract',)]),
                        ('height', [number(e, 60)])]:
        code += [('getlocal', first), *value, ('setproperty', q(prop))]
    code += [('getlocal', first), ('getproperty', q('format')), e.string('left'),
             ('setproperty', q('horizontalAlign')), ('label', 'done')]
    return code


def queue_layout(e):
    result = {}
    target = 'PanelInnerContentItemListTableView/run'
    body = e.body(target); ops = asm.decode(body[5]); assert ops[-1].name == 'returnvoid'
    result[target] = queue(e, target, rows(e, body[2]), len(ops) - 1)
    target = 'PanelInnerContentItemListTableView/draw'
    body = e.body(target); ops = asm.decode(body[5])
    assert ops[148].name == 'findproperty' and e.abc.mn_name(ops[148].args[0]) == 'setElement'
    result[target] = queue(e, target, label(e, body[2]), 148)
    return result
