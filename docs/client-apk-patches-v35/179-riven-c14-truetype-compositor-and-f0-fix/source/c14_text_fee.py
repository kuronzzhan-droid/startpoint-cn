"""Finite fee fitting: at most eleven measurements, font size never below 18."""
import asm
from c1_lookup import number
from c2_common import context, get, queue
from c2_page_view import panel
from c14_text_guards import clamp


def fit_fee(e, first, tag):
    ctx, node, text, width, size, attempts = range(first, first + 6)
    q = e.q; g = lambda n: ('getlocal', n); n = lambda value: number(e, value)
    code = context(e, ctx, tag + '_done')
    code += [g(ctx), *get(e, 'c13_reforge'), ('iffalse', tag + '_done')]
    code += panel(e, 'label_item_select') + [('setlocal', node)]
    code += [g(node), ('callproperty', q('get_text'), 0), ('setlocal', text),
             g(node), e.string(''), ('callpropvoid', q('set_text'), 1),
             g(node), ('pushfalse',), ('callpropvoid', q('set_autoScale'), 1),
             g(node), e.string('none'), ('callpropvoid', q('set_autoSize'), 1),
             g(node), ('callpropvoid', q('disableHtmlText'), 0),
             g(node), ('getproperty', q('rawTextField')), ('pushfalse',), ('setproperty', q('wordWrap')),
             g(node), ('callproperty', q('get_textWidth'), 0)]
    code += clamp(e, width, 48, 1536, tag + '_width') + [('setlocal', width)]
    code += [n(28), ('setlocal', size), n(0), ('setlocal', attempts),
             g(node), g(text), ('callpropvoid', q('set_text'), 1),
             g(node), e.string('horizontal'), ('callpropvoid', q('set_autoSize'), 1),
             ('label', tag + '_measure'), ('avm_label',),
             g(node), ('callproperty', q('get_format'), 0), g(size), ('setproperty', q('size')),
             ('inclocal_i', attempts),
             g(node), ('callproperty', q('get_textWidth'), 0), g(width), ('ifle', tag + '_fit'),
             g(size), n(18), ('ifle', tag + '_wrap'), g(attempts), n(11), ('ifge', tag + '_wrap'),
             ('declocal_i', size), ('jump', tag + '_measure'),
             ('label', tag + '_wrap'),
             g(node), ('getproperty', q('rawTextField')), ('pushtrue',), ('setproperty', q('wordWrap')),
             g(node), n(64), ('callpropvoid', q('set_textHeight'), 1), ('jump', tag + '_restore'),
             ('label', tag + '_fit'), g(node), n(48), ('callpropvoid', q('set_textHeight'), 1),
             ('label', tag + '_restore'),
             g(node), e.string('none'), ('callpropvoid', q('set_autoSize'), 1),
             g(node), g(width), ('callpropvoid', q('set_textWidth'), 1),
             ('label', tag + '_done')]
    return code


def apply(e, label):
    body = e.body(label); ops = asm.decode(body[5]); result = []
    for i, op in enumerate(ops):
        if op.name == 'returnvoid':
            result.append(queue(e, label, fit_fee(e, body[2] + 20, 'c14_fee_' + str(i)), i))
    return result
