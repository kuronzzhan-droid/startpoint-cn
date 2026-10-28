"""C11 quality labels reuse existing fonts and native rarity color values."""
from c1_lookup import number
from c2_common import DYNAMIC
from c10_strings import TEXT

# Normal UI gray; native EX bronze/silver/gold; native rainbow hue is audited
# separately. These are text colors, while thumbnail frames use rarity 1..5.
COLORS = (0x444444, 12020546, 5207684, 12363520, 0x4389B7)


def normalized(e, first, tag):
    """Consume one number, leave an integer quality in the native range 1..5."""
    g = lambda: ('getlocal', first)
    return [('convert_i',), ('setlocal', first), g(), number(e, 1),
            ('ifge', tag + '_low'), number(e, 1), ('setlocal', first),
            ('label', tag + '_low'), g(), number(e, 5), ('ifle', tag + '_ready'),
            number(e, 5), ('setlocal', first), ('label', tag + '_ready'), g()]


def dots(e, first, tag):
    return [*normalized(e, first, tag), ('setlocal', first),
            *(e.string(TEXT['quality_' + str(n)]) for n in range(1, 6)),
            ('newarray', 5), ('getlocal', first), number(e, 1), ('subtract_i',),
            ('getproperty', DYNAMIC)]


def suffix(e, value, first, tag):
    """Append to the existing name already on stack; never embed HTML."""
    return [e.string(TEXT['quality']), ('add',), *value, *dots(e, first, tag), ('add',)]


def paint(e, first, tag, native=True, default=0x444444):
    """Keep receiver,text on stack; tint the title by its explicit quality suffix.

    Native UiText and direct Starling text fields have different format access.
    Only a matching five-dot suffix changes color or scaling. Ordinary shared
    titles are untouched; the weapon-row adapter separately restores its exact
    native color when a recycled view returns to an ordinary equipment row.
    """
    value, node, color = first, first + 1, first + 2
    g = lambda n: ('getlocal', n)
    code = [('setlocal', value), ('setlocal', node), number(e, default), ('setlocal', color)]
    for index, rgb in enumerate(COLORS, 1):
        code += [g(value), e.string(TEXT['quality'] + TEXT['quality_' + str(index)]),
                 ('callproperty', e.q('http://adobe.com/AS3/2006/builtin::indexOf'), 1),
                 number(e, 0), ('iflt', tag + '_next_' + str(index)),
                 number(e, rgb), ('setlocal', color), ('jump', tag + '_apply'),
                 ('label', tag + '_next_' + str(index))]
    fmt = [('callproperty', e.q('get_format'), 0)] if native else [('getproperty', e.q('format'))]
    code += [('jump', tag + '_done'), ('label', tag + '_apply'), g(node), *fmt, g(color),
             ('setproperty', e.q('color')), g(node), ('pushtrue',)]
    code += [('callpropvoid', e.q('set_autoScale'), 1)] if native else [('setproperty', e.q('autoScale'))]
    return code + [('label', tag + '_done'), g(node), g(value)]
