"""Preserve multiline titles across native draw and dialog height calculation."""
import asm
from c1_lookup import number
from c2_common import queue
from c12_layout_text import g


def geometry(e):
    result = {}
    # C8 refreshes this specific title every frame inside its riven context.
    for label in ('ExBoostWindowView/setupButtons', 'ExBoostWindowView/draw'):
        ops = asm.decode(e.body(label)[5])
        marker = max(i for i, op in enumerate(ops) if op.name == 'pushstring'
                     and e.abc.s(op.args[0]) == 'character_name')
        at = next(i for i in range(marker, len(ops)) if ops[i].name == 'callpropvoid'
                  and e.abc.mn_name(ops[i].args[0]) == 'set_autoScale')
        result[label] = queue(e, label, [('pop',), ('pushfalse',)], at, asm.SKIP)
    label = 'DialogItemTitleView/run'; body = e.body(label); ops = asm.decode(body[5])
    node, flag = body[2] + 21, body[2] + 30
    # get_height derives its result from this existing separator's y + height.
    # Moving it also makes the surrounding dialog reserve the larger title.
    code = [g(flag), ('iffalse', 'c12_detail_geometry_done'),
            ('getlocal_0',), ('getproperty', e.q('content')), e.string('line'), ('pushnull',),
            ('callproperty', e.q('getImage'), 2), g(node), ('getproperty', e.q('y')),
            number(e, 88), ('add',), ('setproperty', e.q('y')),
            ('label', 'c12_detail_geometry_done')]
    result[label + ':separator'] = queue(e, label, code, len(ops) - 1)
    label = 'ExBoostSelectDialogView/run'; body = e.body(label); ops = asm.decode(body[5])
    # Authored layout/character_detail has its gray plate at depth 0, followed
    # by name at depth 1. Its next section starts at y=363; 232+26+84=342 fits.
    code = [g(body[2] + 30), ('iffalse', 'c12_selection_geometry_done'), ('getlocal_1',),
            e.string('content'), ('pushnull',), ('callproperty', e.q('getContainer'), 2),
            e.string('character_detail'), ('pushnull',), ('callproperty', e.q('getContainer'), 2),
            number(e, 0), ('callproperty', e.q('getChildAt'), 1), number(e, 84),
            ('setproperty', e.q('height')), ('label', 'c12_selection_geometry_done')]
    result[label + ':background'] = queue(e, label, code, len(ops) - 1)
    return result
