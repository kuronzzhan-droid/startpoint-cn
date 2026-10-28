"""Safe-area geometry applied after the authored EX timeline each frame."""
from c1_lookup import number
from c2_common import context, get, set_, DYNAMIC
from c2_page_view import panel, ui
from c2_presentation import title, global_logic
from c11_icons_emit import quality
from c13_layout_text import g, prop, native_text, quality_html


def width(e, ctx):
    return [g(ctx), *set_(e, 'c13_width', [('getlocal_0',), ('getproperty', e.q('safeArea')),
              ('getproperty', e.q('width')), number(e, 64), ('subtract',)])]


def initialize(e, first):
    return context(e, first, 'c13_width_done') + width(e, first) + [
        g(first), *set_(e, 'c13_viewport', [('pushnull',)]),
        g(first), *set_(e, 'c13_content_height', [('pushnull',)]), ('label', 'c13_width_done')]


def geometry(e, first, tag, refresh=True):
    ctx, root, node, w, h, count, val, index, collection, ident, row, total = range(first, first + 12)
    q = e.q; n = lambda x: number(e, x); gg = lambda name: [('getlocal_0',), ('getproperty', q(name))]
    code = context(e, ctx, tag + '_done') + width(e, ctx)
    code += [g(ctx), *get(e, 'c13_width'), ('setlocal', w), *panel(e), ('setlocal', root)]
    # The bottom-left parent carries safe.bottom-1920. Reset the parent to the
    # safe-area origin, then give the actual panel a symmetric 32px margin.
    code += ui(e, gg('uiLayout'), ['bottom_left']) + [('setlocal', node)]
    code += prop(e, [g(node)], 'x', [*gg('safeArea'), ('getproperty', q('left'))])
    code += prop(e, [g(node)], 'y', [*gg('safeArea'), ('getproperty', q('top'))])
    code += prop(e, [g(root)], 'x', [n(32)]) + prop(e, [g(root)], 'y', [n(180)])
    code += [g(ctx), *get(e, 'record'), *get(e, 'affixes'), ('getproperty', q('length')), ('setlocal', count),
             n(80), ('setlocal', h), g(count), n(0), ('ifle', tag + '_height'),
             *gg('informationAbilityViews'), g(count), n(1), ('subtract_i',), ('getproperty', DYNAMIC),
             ('callproperty', q('getBottomY'), 0), n(16), ('add',), ('setlocal', h), ('label', tag + '_height'),
             g(ctx), *set_(e, 'c13_content_height', [g(h)]),
             ('getlex', q('Math')), n(80), ('getlex', q('Math')), g(h),
             ('getlex', q('Math')), n(160), *gg('safeArea'), ('getproperty', q('height')), n(896), ('subtract',),
             ('callproperty', q('max'), 2), ('callproperty', q('min'), 2), ('callproperty', q('max'), 2), ('setlocal', h)]
    code += [g(ctx), *set_(e, 'c13_viewport', [g(h)])]
    code += [g(root), n(0), ('callproperty', q('getChildAt'), 1), ('setlocal', node)]
    for key, value in [('x', [n(0)]), ('y', [n(0)]), ('width', [g(w)]), ('height', [g(h), n(684), ('add',)])]:
        code += prop(e, [g(node)], key, value)
    code += [g(root), n(2), ('callproperty', q('getChildAt'), 1), ('setlocal', node)]
    for key, value in [('visible', [('pushtrue',)]), ('x', [n(24)]), ('y', [n(436)]),
                       ('width', [g(w), n(48), ('subtract',)]), ('height', [g(h), n(16), ('add',)])]:
        code += prop(e, [g(node)], key, value)
    for names in (['top_right'], ['bottom_center'], ['spot_light_layer'], ['effect_layer']):
        code += ui(e, gg('uiLayout'), names) + [('pushfalse',), ('setproperty', q('visible'))]
    code += ui(e, [g(root)], ['select_item_table']) + [('pushfalse',), ('setproperty', q('visible'))]
    code += prop(e, [*gg('exBoostPixelArtCharacterView'), ('getproperty', q('layer'))], 'visible', [('pushfalse',)])
    code += [*gg('informationContainer'), ('setlocal', node)]
    code += prop(e, [g(node)], 'x', [n(32)]) + prop(e, [g(node)], 'y', [n(444)])
    for field in ('touchArea', 'scrollMask'):
        code += prop(e, gg(field), 'width', [g(w), n(64), ('subtract',)]) + prop(e, gg(field), 'height', [g(h)])
    code += panel(e, 'character_name') + [('setlocal', node)]
    code += native_text(e, node, [n(24)], [n(258)], [g(w), n(48), ('subtract',)], [n(62)], 40, 'center')
    code += [g(node), ('callpropvoid', q('disableHtmlText'), 0)]
    if refresh:
        from c12_layout_text import fit
        code += [*title(e, ctx), ('setlocal', val)]
        code += fit(e, node, val, first + 12, tag + '_name_fit')
        code += [g(node), g(val), ('callpropvoid', q('set_text'), 1)]
    code += panel(e, 'label_now_status_ability') + [('setlocal', node)]
    code += native_text(e, node, [n(32)], [n(384)], [g(w), n(2), ('divide',)], [n(46)], 28)
    if refresh:
        code += [g(node), e.string('当前词条（'), g(count), ('add',), e.string(' 条）'), ('add',), ('callpropvoid', q('set_text'), 1)]
    code += panel(e, 'label_item_select') + [('setlocal', node)]
    code += native_text(e, node, [n(286)], [g(h), n(472), ('add',)], [g(w), n(318), ('subtract',)], [n(48)], 28, 'right')
    code += [g(node), ('pushtrue',), ('callpropvoid', q('set_autoScale'), 1)]
    if refresh:
        code += [g(node), ('getlex', q('pinball.common.tools::StringExtended')), g(ctx), *get(e, 'record'), *get(e, 'next_cost'),
             ('callproperty', q('commaSeparate'), 1), e.string(' 深渊币（持有 '), ('add',),
             ('getlex', q('pinball.common.tools::StringExtended')), *global_logic(e), ('callproperty', q('get_player'), 0), n(2370099),
             ('callproperty', q('getItemNumber'), 1), ('callproperty', q('commaSeparate'), 1), ('add',),
             e.string('）'), ('add',), ('callpropvoid', q('set_text'), 1)]
    # Setup information precedes setup buttons; optional dynamic controls must
    # not be dereferenced until their managed construction has completed.
    code += [g(ctx), *get(e, 'c13_reforge'), ('iffalse', tag + '_done')]
    positions = [('c13_dismantle', [n(164)], [g(h), n(598), ('add',)], None),
                 ('c13_reforge', [g(w), n(2), ('divide',), n(152), ('add',)], [g(h), n(598), ('add',)], None),
                 ('c8_arrow_left', [n(144)], [n(52)], None),
                 ('c8_arrow_right', [g(w), n(144), ('subtract',)], [n(52)], None),
                 ('c13_index', [g(w), n(2), ('divide',), n(150), ('subtract',)], [n(28)], None),
                 ('c13_quality', [n(24)], [n(324)], [g(w), n(48), ('subtract',)]),
                 ('c13_rolls', [g(w), n(2), ('divide',)], [n(384)], [g(w), n(2), ('divide',), n(32), ('subtract',)]),
                 ('c13_fee_label', [n(32)], [g(h), n(472), ('add',)], [n(254)])]
    for key, x, y, fw in positions:
        code += [g(ctx), *get(e, key), ('setlocal', node)]
        code += prop(e, [g(node)], 'x', x) + prop(e, [g(node)], 'y', y)
        if fw is not None: code += prop(e, [g(node)], 'width', fw)
    if refresh:
        code += [g(ctx), *get(e, 'c13_rolls'), e.string('已重铸 '), g(ctx), *get(e, 'record'), *get(e, 'roll_count'),
             ('add',), e.string(' 次'), ('add',), ('setproperty', q('text'))]
        code += [g(ctx), *get(e, 'c13_quality'), ('setlocal', node)]
        code += prop(e, [g(node)], 'isHtmlText', [('pushtrue',)])
        code += [g(node), *(e.string(quality_html(i)) for i in range(1, 6)), ('newarray', 5),
             *quality(e, [g(ctx), *get(e, 'record')], val, tag + '_quality'), n(1), ('subtract_i',),
             ('getproperty', DYNAMIC), ('setproperty', q('text'))]
    code += [g(ctx), *get(e, 'c8_thumbnail'), ('setlocal', node), g(node), g(w), n(2), ('divide',),
             ('callpropvoid', q('set_x'), 1), g(node), n(168), ('callpropvoid', q('set_y'), 1)]
    if not refresh:
        return code + [('label', tag + '_done')]
    # Count the same current save records as C8 navigation. Position follows its
    # riven_id descending / item_id descending tie order without sorting copies.
    from c8_navigation import records
    code += [*records(e), ('setlocal', collection), n(0), ('setlocal', total), n(1), ('setlocal', index),
             n(16000001), ('setlocal', ident), ('label', tag + '_scan'), ('avm_label',), g(ident), n(16000999),
             ('ifgt', tag + '_scanned'), g(collection), g(ident), ('getproperty', DYNAMIC), ('setlocal', row),
             g(row), ('iffalse', tag + '_next'), ('inclocal_i', total), g(row), *get(e, 'riven_id'),
             g(ctx), *get(e, 'record'), *get(e, 'riven_id'), ('ifgt', tag + '_before'),
             g(row), *get(e, 'riven_id'), g(ctx), *get(e, 'record'), *get(e, 'riven_id'), ('ifne', tag + '_next'),
             g(ident), g(ctx), *get(e, 'item_id'), ('ifle', tag + '_next'), ('label', tag + '_before'),
             ('inclocal_i', index), ('label', tag + '_next'), ('inclocal_i', ident), ('jump', tag + '_scan'),
             ('label', tag + '_scanned'), g(ctx), *get(e, 'c13_index'), g(index), ('convert_s',), e.string(' / '),
             ('add',), g(total), ('add',), ('setproperty', q('text')), ('label', tag + '_done')]
    return code
