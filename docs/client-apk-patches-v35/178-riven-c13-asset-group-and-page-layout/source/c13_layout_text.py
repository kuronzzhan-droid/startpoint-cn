"""C13 inline text presentation; original font and native vertical measurement."""
import asm
from c1_lookup import number
from c2_common import context, get, queue
from c2_page_view import ui


def g(n):
    return ('getlocal', n)


def prop(e, source, name, value):
    return [*source, *value, ('setproperty', e.q(name))]


def fmt(e, node, name, value, native=True):
    source = [g(node), ('callproperty', e.q('get_format'), 0)] if native else [g(node), ('getproperty', e.q('format'))]
    return prop(e, source, name, value)


def native_text(e, node, x, y, width, height, size=32, align='left'):
    code = prop(e, [g(node)], 'x', x) + prop(e, [g(node)], 'y', y)
    for key, val in [('textWidth', width), ('textHeight', height), ('autoScale', [('pushfalse',)])]:
        code += [g(node), *val, ('callpropvoid', e.q('set_' + key), 1)]
    code += fmt(e, node, 'size', [number(e, size)]) + fmt(e, node, 'color', [number(e, 0x444444)])
    code += fmt(e, node, 'horizontalAlign', [e.string(align)]) + fmt(e, node, 'letterSpacing', [number(e, 0)])
    code += [g(node), ('getproperty', e.q('rawTextField')), ('pushfalse',), ('setproperty', e.q('wordWrap'))]
    return code


def quality_html(n):
    return '<font size="28" color="#555555">品质 </font>' + ''.join(
        '<font size="28" color="#%s">%s</font>' % ('bca700' if i < n else '999999', '●' if i < n else '○')
        for i in range(5))


def annotation(e, value, first, tag):
    """Only the explanatory multiplier moves to its own smaller second line."""
    return [g(value), e.string('<font color="#ea354c">'),
            ('callproperty', e.q('http://adobe.com/AS3/2006/builtin::indexOf'), 1), ('setlocal', first),
            g(value), ('getlex', e.q('RegExp')), e.string('<font color="#ea354c">|</font>'),
            e.string('g'), ('construct', 2), e.string(''),
            ('callproperty', e.q('replace'), 2), ('setlocal', value),
            ('getlex', e.q('StringTools')), g(value), ('pushfalse',), ('callproperty', e.q('htmlEscape'), 2),
            ('setlocal', value), g(value), ('getlex', e.q('RegExp')),
            e.string('[ \\u3000]*[（(](独立伤害乘区[^）)]*)[）)]'), e.string('g'), ('construct', 2),
            e.string('\n<font size="24">（$1）</font>'),
            ('callproperty', e.q('replace'), 2), ('setlocal', value),
            g(first), number(e, 0), ('iflt', tag + '_color_done'), e.string('<font color="#ea354c">'),
            g(value), ('add',), e.string('</font>'), ('add',), ('setlocal', value), ('label', tag + '_color_done')]


def queue_text(e):
    result = {}
    label = 'ExBoostInformationAbilityView/applyExAbility'; body = e.body(label); ops = asm.decode(body[5])
    marker = next(i for i, op in enumerate(ops) if op.name == 'pushstring' and e.abc.s(op.args[0]) == 'description')
    at = next(i for i in range(marker, len(ops)) if ops[i].name == 'callpropvoid' and e.abc.mn_name(ops[i].args[0]) == 'set_text')
    ctx, node, value = range(body[2], body[2] + 3)
    code = [('setlocal', value), ('setlocal', node), *context(e, ctx, 'c13_ability_plain')]
    code += annotation(e, value, body[2] + 3, 'c13_ability')
    code += native_text(e, node, [number(e, 8)], [number(e, 8)],
                        [g(ctx), *get(e, 'c13_width'), number(e, 80), ('subtract',)], [number(e, 80)], 32)
    code += [g(node), ('callpropvoid', e.q('enableHtmlText'), 0), g(node), e.string('vertical'),
             ('callpropvoid', e.q('set_autoSize'), 1), g(node), ('getproperty', e.q('rawTextField')),
             ('pushtrue',), ('setproperty', e.q('wordWrap'))]
    code += ui(e, [('getlocal_0',), ('getproperty', e.q('layout'))], ['icon'])
    code += [('pushfalse',), ('setproperty', e.q('visible')), ('label', 'c13_ability_plain'), g(node), g(value)]
    result[label] = {'riven': queue(e, label, code, at, asm.SKIP)}
    ordinary_at = next(i for i, op in enumerate(ops) if op.name == 'returnvoid') + 1
    reset = ui(e, [('getlocal_0',), ('getproperty', e.q('layout'))], [], 'description') + [('setlocal', node)]
    reset += native_text(e, node, [number(e, 51)], [number(e, 0)], [number(e, 560)], [number(e, 50)])
    reset += [g(node), ('callpropvoid', e.q('disableHtmlText'), 0), g(node), e.string('vertical'),
              ('callpropvoid', e.q('set_autoSize'), 1), g(node), ('getproperty', e.q('rawTextField')),
              ('pushtrue',), ('setproperty', e.q('wordWrap'))]
    reset += ui(e, [('getlocal_0',), ('getproperty', e.q('layout'))], ['icon']) + [('pushtrue',), ('setproperty', e.q('visible'))]
    result[label]['ordinary_restore'] = queue(e, label, reset, ordinary_at)
    label = 'ExBoostInformationAbilityView/fitHeight'; body = e.body(label); ops = asm.decode(body[5])
    # Native getBottomY derives from border.y. Include full text and 16px gap.
    code = context(e, body[2], 'c13_fit_done') + ui(e, [('getlocal_0',), ('getproperty', e.q('layout'))], [])
    code += [e.string('border'), ('pushnull',), ('callproperty', e.q('getImage'), 2), ('setlocal', body[2] + 1)]
    code += ui(e, [('getlocal_0',), ('getproperty', e.q('layout'))], [], 'description')
    code += [('setlocal', body[2] + 2)]
    code += prop(e, [g(body[2] + 1)], 'y', [g(body[2] + 2), ('getproperty', e.q('height')), number(e, 24), ('add',)])
    code += prop(e, [g(body[2] + 1)], 'width', [g(body[2]), *get(e, 'c13_width'), number(e, 64), ('subtract',)])
    code += [('label', 'c13_fit_done')]
    result[label] = queue(e, label, code, len(ops) - 1)
    label = 'ExBoostDetailView/createText'; body = e.body(label); ops = asm.decode(body[5])
    code = context(e, body[2], 'c13_detail_original') + annotation(e, 1, body[2] + 1, 'c13_detail')
    code += [('label', 'c13_detail_original')]
    result[label] = {'annotation': queue(e, label, code)}
    at = next(i for i, op in enumerate(ops) if op.name == 'callpropvoid' and e.abc.mn_name(op.args[0]) == 'set_text')
    code = context(e, body[2] + 1, 'c13_detail_html_done') + [g(3), ('callpropvoid', e.q('enableHtmlText'), 0),
           g(3), ('pushfalse',), ('callpropvoid', e.q('set_autoScale'), 1),
           g(3), ('getproperty', e.q('rawTextField')), ('pushtrue',), ('setproperty', e.q('wordWrap')),
           ('label', 'c13_detail_html_done')]
    result[label]['html'] = queue(e, label, code, at, asm.SKIP)
    return result


def restore_page_title(e, first):
    """C13 uses plain text, so C12's HTML-state marker no longer restores it."""
    ctx, node = first, first + 1
    code = context(e, ctx, 'c13_title_restore') + [('jump', 'c13_title_restored'), ('label', 'c13_title_restore')]
    from c2_page_view import panel
    code += panel(e, 'character_name') + [('setlocal', node)]
    for source, target in [('fontSize', 'size'), ('letterSpacing', 'letterSpacing')]:
        code += [g(node), ('callproperty', e.q('get_format'), 0), g(node), ('getproperty', e.q('data')),
                 ('getproperty', e.q('attributes')), ('getproperty', e.q(source)), ('setproperty', e.q(target))]
    for source, target in [('width', 'textWidth'), ('height', 'textHeight')]:
        code += [g(node), g(node), ('getproperty', e.q('data')), ('getproperty', e.q('attributes')),
                 ('getproperty', e.q(source)), ('callpropvoid', e.q('set_' + target), 1)]
    code += [g(node), ('pushtrue',), ('callpropvoid', e.q('set_autoScale'), 1),
             g(node), ('getproperty', e.q('rawTextField')), ('pushtrue',), ('setproperty', e.q('wordWrap')),
             ('label', 'c13_title_restored')]
    return code
