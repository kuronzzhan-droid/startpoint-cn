"""Closed stack replacements for native item thumbnails and rarity frames."""
from c1_lookup import lookup, number
from c2_common import context, get
from c2_presentation import global_logic


def quality(e, record, first, tag):
    """Leave the display-only disposition, clamped to existing rarity 1..5."""
    return [*record, *get(e, 'disposition'), ('convert_i',), ('setlocal', first),
            ('getlocal', first), number(e, 1), ('ifge', tag + '_max'),
            number(e, 1), ('setlocal', first), ('label', tag + '_max'),
            ('getlocal', first), number(e, 5), ('ifle', tag + '_done'),
            number(e, 5), ('setlocal', first), ('label', tag + '_done'),
            ('getlocal', first)]


def image(e, ident):
    return [*global_logic(e), *ident, ('convert_i',),
            ('callproperty', e.q('getItem'), 1),
            ('callproperty', e.q('get_thumbnailId'), 0)]


def source_image(e, first, tag):
    """Replace a soul source's thumbnail only for the reserved item range."""
    return [('getlocal_1',), ('getproperty', e.q('id')), ('setlocal', first),
            ('getlocal', first), number(e, 16000000), ('iflt', tag + '_done'),
            ('getlocal', first), number(e, 16000999), ('ifgt', tag + '_done'),
            ('pop',), *image(e, [('getlocal', first)]), ('label', tag + '_done')]


def source_quality(e, first, tag):
    ident, scratch, record, value = range(first, first + 4)
    find = lookup(e, ident, scratch, record, tag + '_done')
    find = [number(e, 16000999) if op == number(e, 16000200) else op for op in find]
    return [('getlocal_1',), ('getproperty', e.q('id')), ('setlocal', ident),
            *find, ('pop',), *quality(e, [('getlocal', record)], value, tag + '_value'),
            ('label', tag + '_done')]


def context_image(e, first, tag):
    return [*context(e, first, tag + '_done'), ('pop',),
            *image(e, [('getlocal', first), *get(e, 'item_id')]),
            ('label', tag + '_done')]


def context_quality(e, first, tag):
    return [*context(e, first, tag + '_done'), ('pop',),
            *quality(e, [('getlocal', first), *get(e, 'record')], first + 1, tag + '_value'),
            ('label', tag + '_done')]
