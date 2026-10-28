"""Local Riven text guards; every block is inserted into an existing method."""
import asm
from c1_lookup import number
from c2_common import context, queue


def clamp(e, scratch, low, high, tag):
    """Consume/return one Number; NaN and negative values take the safe floor."""
    g = lambda n: ('getlocal', n)
    return [('setlocal', scratch), g(scratch), number(e, low), ('ifge', tag + '_low'),
            number(e, low), ('setlocal', scratch), ('label', tag + '_low'),
            g(scratch), number(e, high), ('ifle', tag + '_high'),
            number(e, high), ('setlocal', scratch), ('label', tag + '_high'), g(scratch)]


def guarded_clamp(e, first, low, high, tag):
    return context(e, first, tag + '_done') + clamp(e, first + 1, low, high, tag) + [('label', tag + '_done')]


def guard_setters(e, label):
    body = e.body(label); ops = asm.decode(body[5]); result = []
    for i, op in enumerate(ops):
        name = e.abc.mn_name(op.args[0]) if op.args and op.name in ('callpropvoid', 'setproperty', 'initproperty') else ''
        bounds = {'set_textWidth': (48, 1536), 'set_textHeight': (48, 1536)}.get(name)
        if op.name in ('setproperty', 'initproperty') and name == 'size': bounds = (18, 64)
        if op.name == 'setproperty' and name == 'width': bounds = (48, 1536)
        if bounds:
            code = guarded_clamp(e, body[2] + 4, *bounds, 'c14_guard_' + str(i))
            result.append(queue(e, label, code, i, asm.SKIP))
    return result


def guard_native_creation(e, label):
    body = e.body(label); ops = asm.decode(body[5]); result = []
    first = body[2] + 12; g = lambda n: ('getlocal', n)
    if label == 'ExBoostDetailView/createText':
        at = next(i for i, op in enumerate(ops) if op.name == 'callproperty'
                  and e.abc.mn_name(op.args[0]) == 'create')
    elif label == 'BoxButtonContentView/addTextField':
        at = next(i for i, op in enumerate(ops) if op.name == 'constructprop'
                  and e.abc.mn_name(op.args[0]) == 'starling.text::TextField')
    else:
        return result
    tag = 'c14_native_create'
    code = context(e, first, tag + '_done') + [('setlocal', first + 1)]
    code += clamp(e, first + 2, 48, 1536, tag + '_width')
    code += [g(first + 1)] + clamp(e, first + 2, 48, 1536, tag + '_height')
    code += [('label', tag + '_done')]
    result.append(queue(e, label, code, at, asm.SKIP))
    return result


def clear_before_fit(e, label):
    """A width getter recomposes: discard stale HTML before changing modes."""
    body = e.body(label); ops = asm.decode(body[5]); result = []
    for i, op in enumerate(ops):
        if op.name != 'callproperty' or e.abc.mn_name(op.args[0]) != 'get_textWidth': continue
        # The first read saves the fixed limit; loop reads compare with it.
        if ops[i + 1].name != 'setlocal': continue
        tag = 'c14_fit_' + str(i)
        code = context(e, body[2] + 4, tag + '_done')
        code += [('dup',), e.string(''), ('callpropvoid', e.q('set_text'), 1), ('label', tag + '_done')]
        result.append(queue(e, label, code, i, asm.SKIP))
    return result


def guard_fields(e, label):
    """C13 raw TextField constructors get explicit dimensions and font floors."""
    body = e.body(label); ops = asm.decode(body[5]); result = []
    q = e.q; first = body[2] + 8; g = lambda n: ('getlocal', n)
    starts = [i for i, op in enumerate(ops) if op.name == 'getlex'
              and e.abc.mn_name(op.args[0]) == 'starling.text::TextField']
    for start in starts:
        at = next(i for i in range(start + 1, len(ops)) if ops[i].name == 'construct' and ops[i].args == [4])
        tag = 'c14_field_' + str(at)
        # Stack after construction contains the new field. Its getters are not
        # read until dimensions/style are safe; constructor bounds are constants.
        code = context(e, first, tag + '_done') + [('dup',), ('setlocal', first + 1)]
        for name, low, high in [('width', 48, 1536), ('height', 48, 1536)]:
            code += [g(first + 1), g(first + 1), ('getproperty', q(name))]
            code += clamp(e, first + 2, low, high, tag + '_' + name)
            code += [('setproperty', q(name))]
        code += [g(first + 1), ('getproperty', q('format')), ('dup',), ('getproperty', q('size'))]
        code += clamp(e, first + 2, 18, 64, tag + '_font') + [('setproperty', q('size'))]
        for name, value in [('autoScale', ('pushfalse',)), ('autoSize', e.string('none'))]:
            code += [g(first + 1), value, ('setproperty', q(name))]
        code += [('label', tag + '_done')]
        result.append(queue(e, label, code, at + 1, asm.SKIP))
    return result
