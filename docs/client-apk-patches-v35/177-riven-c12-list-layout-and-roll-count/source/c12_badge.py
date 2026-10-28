"""C12 native stack badge: revealed records display the current reroll count."""
import asm
from c1_lookup import number
from c2_common import get, queue
from c9_lists import current_lookup

PURPLE = 0xC084FC
NATIVE_COLOR = 0xFFFFFF


def decorate(e, thumbnail, ident_code, first, tag):
    """Use the existing number label, preserving its native digit measurement."""
    ident, scratch, record, label, count = range(first, first + 5)
    g = lambda n: ('getlocal', n)
    q = e.q
    return [*ident_code, ('setlocal', ident),
            *current_lookup(e, ident, scratch, record, tag + '_done'),
            *thumbnail, ('getproperty', q('frame')),
            ('callproperty', q('getOrCreateNumberLabel'), 0), ('setlocal', label),
            g(record), *get(e, 'roll_count'), ('convert_i',), ('setlocal', count),
            # Native setStack(0) hides the entire layout. Render stack frame 2,
            # replace its digit with 0, then repeat the native width placement.
            g(count), ('iftrue', tag + '_nonzero'),
            g(label), number(e, 1), ('callpropvoid', q('setStack'), 1),
            g(label), ('getproperty', q('textField')), e.string('0'),
            ('callpropvoid', q('set_text'), 1),
            g(label), ('getproperty', q('stackIcon')),
            g(label), ('getproperty', q('textField')),
            ('callproperty', q('get_bounds'), 0), ('getproperty', q('right')),
            g(label), ('getproperty', q('textField')),
            ('callproperty', q('get_textBounds'), 0), ('getproperty', q('width')),
            ('subtract',), g(label), ('getproperty', q('stackIcon')),
            ('getproperty', q('width')), ('subtract',), number(e, 3), ('add',),
            ('setproperty', q('x')), ('jump', tag + '_color'),
            ('label', tag + '_nonzero'), g(label), g(count),
            ('callpropvoid', q('setStack'), 1),
            ('label', tag + '_color'),
            g(label), ('getproperty', q('stackIcon')), number(e, PURPLE),
            ('setproperty', q('color')), ('label', tag + '_done')]


def apply(e):
    result = {}
    label = 'EquipmentListTableItemView/apply'
    body = e.body(label); ops = asm.decode(body[5])
    points = [i for i, op in enumerate(ops) if op.name == 'callpropvoid'
              and e.abc.mn_name(op.args[0]) == 'showStack']
    assert len(points) == 2
    # The original equipment branch skips showStack when its cached quantity
    # matches. Invalidate that existing cache after a riven has taken the badge
    # over so reusing the row for an unchanged ordinary quantity still restores.
    code = [('getlocal_0',), number(e, 1), ('negate',),
            ('setproperty', e.q('equipmentStack'))]
    code += decorate(e, [('getlocal_0',), ('getproperty', e.q('thumbnailView'))],
                    [('getlocal_1',), *get(e, 'item_id')], body[2] + 60, 'c12_weapon_badge')
    result[label] = queue(e, label, code, points[0] + 1, asm.SKIP)
    for label, info, thumbnail in [('PanelInnerContentItemListTableView/draw', 5, 6),
                                   ('PanelInnerContentItemListTableView/apply', 14, 12)]:
        body = e.body(label); ops = asm.decode(body[5])
        if label.endswith('/draw'):
            assert ops[86].name == 'setlocal' and ops[86].args == [6]
            point = 87
        else:
            points = [i for i, op in enumerate(ops) if op.name == 'callpropvoid'
                      and e.abc.mn_name(op.args[0]) == 'showItem']
            assert len(points) == 1
            point = points[0] + 1
        code = decorate(e, [('getlocal', thumbnail),
                            ('callproperty', e.q('getItemThumbnail'), 0)],
                        [('getlocal', info), ('getproperty', e.q('itemId'))],
                        body[2] + 60, 'c12_panel_badge')
        result[label] = queue(e, label, code, point, asm.SKIP)

    # UiImage derives from Starling Image: its native color setter is the
    # appropriate GPU tint. All ordinary native quantity setters restore the
    # unmodified texture tint before updating a reused number label.
    for method in ('setStack', 'setNumber', 'setRemaining'):
        label = 'ThumbnailNumberLabel/' + method
        code = [('getlocal_0',), ('getproperty', e.q('stackIcon')),
                ('getproperty', e.q('color')), number(e, PURPLE),
                ('ifne', 'c12_native_color_done'),
                ('getlocal_0',), ('getproperty', e.q('stackIcon')),
                number(e, NATIVE_COLOR), ('setproperty', e.q('color')),
                ('label', 'c12_native_color_done')]
        result[label] = queue(e, label, code, 2)
    return {'methods': result, 'color': PURPLE, 'native_color': NATIVE_COLOR,
            'native_label': 'ThumbnailNumberLabel',
            'number_source': 'current save weapon_rivens[itemId].roll_count',
            'unknown_item_untouched': 16000000, 'instance_range': [16000001, 16000999],
            'zero': 'native stack frame 2 remains visible with text 0',
            'digits': 'native setStack textBounds width and stackIcon.x positioning'}
