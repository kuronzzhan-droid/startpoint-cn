"""Riven-only managed rectangular buttons; native IDs and callbacks are retained."""
from c1_lookup import number
from c2_common import context, get, set_, OPTION
from c2_page_view import panel, ui
from c11_icons_emit import image, quality
from c8_navigation import LEFT, RIGHT
from c13_layout_text import g, prop


def field(e, ctx, node, key, parent, width=300, height=50, size=28, text='', align='center'):
    q = e.q
    code = [('getlex', q('starling.text::TextField')), number(e, width), number(e, height), e.string(text),
            ('getlex', q('starling.text::TextFormat')), ('getlex', q('pinball.font::Fonts')),
            ('callproperty', q('get_defaultFont'), 0), ('getproperty', q('fontName')), number(e, size),
            number(e, 0x444444), ('construct', 3), ('construct', 4), ('setlocal', node)]
    code += prop(e, [g(node)], 'name', [e.string(key)]) + prop(e, [g(node)], 'touchable', [('pushfalse',)])
    code += prop(e, [g(node)], 'wordWrap', [('pushfalse',)])
    code += prop(e, [g(node), ('getproperty', q('format'))], 'horizontalAlign', [e.string(align)])
    code += [*parent, g(node), ('callpropvoid', q('addChild'), 1), g(ctx), *set_(e, key, [g(node)])]
    return code


def button(e, ctx, node, key, ident, text, width, positive=False):
    q = e.q
    return [('getlex', q('starling.display::Sprite')), ('construct', 0), ('setlocal', node),
            *panel(e), g(node), ('callpropvoid', q('addChild'), 1), g(ctx), *set_(e, key, [g(node)]),
            ('getlocal_0',), ('getproperty', q('buttonGroupView')), number(e, ident), g(node),
            ('getlex', q('flash.geom::Rectangle')), number(e, 0), number(e, 0), *width,
            number(e, 104 if ident in (33554432, 150994944) else 64), ('construct', 4),
            ('getlex', q('pinball.ui.component.button.config::ButtonConfigs')), e.string(text),
            ('callproperty', q('positiveWithCustomString' if positive else 'negativeWithCustomString'), 1),
            ('callpropvoid', q('addWithConfig'), 4)]


def setup(e, first):
    ctx, node, thumb, info = range(first, first + 4); q = e.q
    code = context(e, ctx, 'c13_controls_original')
    from c13_layout_page import width
    code += width(e, ctx)
    code += [('getlocal_0',), ('getlocal_0',), ('getproperty', q('gear')),
             ('getlex', q('pinball.ui.component.button::ButtonGroupView')),
             ('getlocal_0',), ('getproperty', q('peek')), ('callproperty', q('getButtonGroup'), 0), ('construct', 1),
             ('pushnull',), ('callproperty', q('addChild'), 2), ('setproperty', q('buttonGroupView'))]
    code += [('getlocal_0',), ('getlex', q('starling.display::Sprite')), ('construct', 0),
             ('setproperty', q('characterSelectButtonContainer'))]
    # draw retains these legacy fields but all rendered/clickable controls below
    # are registered once with their actual 104px rectangular native hitboxes.
    code += [('getlocal_0',), *ui(e, [('getlocal_0',), ('getproperty', q('uiLayout'))], ['bottom_center', 'ex_boost_button']),
             ('setproperty', q('exBoostButton'))]
    for names in (['top_right'], ['bottom_center']):
        code += ui(e, [('getlocal_0',), ('getproperty', q('uiLayout'))], names) + [('pushfalse',), ('setproperty', q('visible'))]
    for key, ident, text, width, positive in [
        ('c13_dismantle', 150994944, '分解', [number(e, 264)], False),
        ('c13_reforge', 33554432, '重铸', [g(ctx), *get(e, 'c13_width'), number(e, 368), ('subtract',)], True),
        ('c8_arrow_left', LEFT, '‹ 上一张', [number(e, 240)], False),
        ('c8_arrow_right', RIGHT, '下一张 ›', [number(e, 240)], False)]:
        code += button(e, ctx, node, key, ident, text, width, positive)
    for key, size, text, align in [('c13_index', 28, '', 'center'), ('c13_quality', 28, '', 'center'),
                                  ('c13_rolls', 28, '', 'right'), ('c13_fee_label', 28, '本次重铸费用', 'left')]:
        code += field(e, ctx, node, key, panel(e), size=size, text=text, align=align)
    code += [('getlex', q('pinball.ui.component.item::ItemThumbnailView')), *panel(e),
             ('getlex', q(OPTION)), *image(e, [g(ctx), *get(e, 'item_id')]), ('callproperty', q('Some'), 1),
             ('getlex', q(OPTION)), *quality(e, [g(ctx), *get(e, 'record')], first + 4, 'c13_thumb'),
             ('callproperty', q('Some'), 1), ('construct', 3), ('setlocal', thumb),
             ('getlocal_0',), ('getproperty', q('gear')), g(thumb), ('pushnull',), ('callpropvoid', q('addChild'), 2),
             g(ctx), *set_(e, 'c8_thumbnail', [g(thumb)]), g(thumb), number(e, 144), number(e, 168), ('divide',),
             ('callpropvoid', q('set_scale'), 1)]
    # A flat neutral native Quad covers the old gold/pedestal imagery behind
    # the panel. It is visual only and never intercepts the native buttons.
    code += [('getlex', q('pinball.ui.display::QuadTools')), number(e, 1080), number(e, 1920), number(e, 0xF2F2F2),
             number(e, 1), ('callproperty', q('create'), 4), ('setlocal', node),
             g(node), ('pushfalse',), ('setproperty', q('touchable')), ('getlocal_0',), ('getproperty', q('uiLayout')),
             g(node), number(e, 0), ('callpropvoid', q('addChildAt'), 2), g(ctx), *set_(e, 'c13_backdrop', [g(node)])]
    from c13_layout_page import geometry
    code += geometry(e, first + 10, 'c13_initial')
    code += [('getlocal_0',), ('callpropvoid', q('refreshExAbilitiesScrollArea'), 0)]
    return code + [('returnvoid',), ('label', 'c13_controls_original')]
