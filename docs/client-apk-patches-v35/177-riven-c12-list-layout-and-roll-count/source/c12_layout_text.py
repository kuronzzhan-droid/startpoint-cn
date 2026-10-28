"""C12 inline text emitters; use the original font's measured width."""
from c1_lookup import number
from c2_common import DYNAMIC
from c11_quality_tokens import COLORS

GRAY = 0x999999


def g(index):
    return ('getlocal', index)


def read(e, node, prop, native):
    return [g(node), ('callproperty', e.q('get_' + prop), 0)] if native else [g(node), ('getproperty', e.q(prop))]


def write(e, node, prop, value, native):
    return [g(node), *value, ('callpropvoid', e.q('set_' + prop), 1)] if native else [g(node), *value, ('setproperty', e.q(prop))]


def raw(e, node, native):
    return [g(node), ('getproperty', e.q('rawTextField'))] if native else [g(node)]


def plain(e, node, native, color):
    return [*raw(e, node, native), ('pushfalse',), ('setproperty', e.q('isHtmlText')),
            *raw(e, node, native), ('pushfalse',), ('setproperty', e.q('wordWrap')),
            *write(e, node, 'autoScale', [('pushfalse',)], native),
            *read(e, node, 'format', native), number(e, color), ('setproperty', e.q('color'))]


def fit(e, node, value, first, tag, native=True):
    """Trim only when native HORIZONTAL auto-size measures beyond the old width.

    UiText.get_textWidth delegates to Starling TextField.width, whose native
    getter recomposes HORIZONTAL text before returning its actual width.
    The original fixed width is restored after appending the existing ellipsis
    glyph. The same measurement path handles mixed CJK/Latin names.
    """
    limit, original, count = range(first, first + 3)
    width = 'textWidth' if native else 'width'
    code = [*read(e, node, width, native), ('setlocal', limit), g(value), ('setlocal', original),
            g(value), ('getproperty', e.q('length')), ('setlocal', count),
            *write(e, node, 'autoSize', [e.string('horizontal')], native),
            ('label', tag + '_measure'), ('avm_label',),
            *write(e, node, 'text', [g(value)], native),
            *read(e, node, width, native), g(limit), ('ifle', tag + '_done'),
            g(count), number(e, 0), ('ifle', tag + '_done'), ('declocal_i', count),
            g(original), number(e, 0), g(count),
            ('callproperty', e.q('http://adobe.com/AS3/2006/builtin::substr'), 2),
            e.string('…'), ('add',), ('setlocal', value), ('jump', tag + '_measure'),
            ('label', tag + '_done'),
            *write(e, node, 'autoSize', [e.string('none')], native),
            *write(e, node, width, [g(limit)], native)]
    return code


def quality_html(quality, size=20):
    color = COLORS[quality - 1]
    gap = '<font size="10"> </font>'
    dots = gap.join(f'<font size="{size}" color="#{color if n < quality else GRAY:06x}">{"●" if n < quality else "○"}</font>'
                   for n in range(5))
    return f'<font size="16">品质</font>{gap}{dots}'


def quality(e, value, size=20):
    return [*(e.string(quality_html(n, size)) for n in range(1, 6)), ('newarray', 5),
            g(value), number(e, 1), ('subtract_i',), ('getproperty', DYNAMIC)]


def escaped(e, value):
    return [('getlex', e.q('StringTools')), g(value), ('pushfalse',),
            ('callproperty', e.q('htmlEscape'), 2)]
