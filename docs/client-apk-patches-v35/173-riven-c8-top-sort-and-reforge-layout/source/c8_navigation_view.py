"""Existing carousel arrow assets on the existing EX page button group."""
import asm
from c1_lookup import number
from c2_common import context, get, set_, queue
from c2_page_view import panel
from c4_dismantle import owned_window
from c8_navigation import LEFT, RIGHT


def setup(e, first):
    q = e.q
    ctx, arrow = first, first + 1
    code = context(e, ctx, 'c8_arrows_done')
    for direction, ident, x in [(0, LEFT, 28), (1, RIGHT, 686)]:
        field = 'c8_arrow_left' if direction == 0 else 'c8_arrow_right'
        code += [('getlex', q('pinball.ui.component.carousel.button::CarouselSideButtonSprite')),
                 ('getlocal_0',), ('getproperty', q('view')), ('getproperty', q('asset')),
                 ('getlex', q('pinball.ui.component.carousel.button::CarouselSideButtonStyle')),
                 ('getproperty', q('TransparentSmall')), number(e, direction), ('construct', 3),
                 ('setlocal', arrow), *panel(e), ('getlocal', arrow), ('callpropvoid', q('addChild'), 1),
                 ('getlocal', arrow), number(e, x), ('setproperty', q('x')),
                 ('getlocal', arrow), number(e, 550), ('setproperty', q('y')),
                 ('getlocal', arrow), ('getlocal_0',), ('getproperty', q('peek')),
                 ('callproperty', q('needShowSideArrow'), 0), ('setproperty', q('visible')),
                 ('getlocal', ctx), *set_(e, field, [('getlocal', arrow)]),
                 ('getlocal_0',), ('getproperty', q('buttonGroupView')), number(e, ident),
                 ('getlocal', arrow), ('getlex', q('pinball.ui.component.button.behavior::ButtonAnimationBehaviorKind')),
                 ('getproperty', q('Scale')), ('callpropvoid', q('registerDisplayObjectAsButton'), 3)]
    return code + [('label', 'c8_arrows_done')]


def register(e, first):
    code = context(e, first, 'c8_register_done')
    for ident in (LEFT, RIGHT):
        code += [('getlocal_0',), ('getproperty', e.q('buttonGroup')), number(e, ident),
                 ('callpropvoid', e.q('append'), 1)]
    return code + [('label', 'c8_register_done')]


def swipe_area(e, first):
    return context(e, first, 'c8_area_original') + [
        ('pushtrue',), ('returnvalue',), ('label', 'c8_area_original')]


def refresh_arrows(e, first):
    ctx, show, arrow = range(first, first + 3)
    q = e.q
    code = context(e, ctx, 'c8_refresh_done') + owned_window(e, ctx, 'c8_refresh_done') + [
        ('getlocal_0',), ('callproperty', q('needShowSideArrow'), 0), ('setlocal', show)]
    for index, field in enumerate(('c8_arrow_left', 'c8_arrow_right')):
        code += [('getlocal', ctx), *get(e, field), ('setlocal', arrow),
                 ('getlocal', arrow), ('iffalse', 'c8_refresh_next_' + str(index)),
                 ('getlocal', arrow), ('getlocal', show), ('setproperty', q('visible')),
                 ('label', 'c8_refresh_next_' + str(index))]
    return code + [('label', 'c8_refresh_done')]


def queue_navigation_view(e):
    result = {}
    for label, fn in [('ExBoostWindowView/setupButtons', setup), ('ExBoostWindow/run', register),
                      ('ExBoostWindow/updateExBoostItems', refresh_arrows)]:
        body = e.body(label)
        ops = asm.decode(body[5])
        assert ops[-1].name == 'returnvoid'
        result[label] = queue(e, label, fn(e, body[2]), len(ops) - 1)
    label = 'ExBoostWindowView/canBeginSwipe'
    result[label] = queue(e, label, swipe_area(e, e.body(label)[2]))
    # Original Haxe ternary tail targets code_length after both returnvalue
    # arms; provide a legal unreachable fallback for the strict verifier.
    queue(e, label, [('pushfalse',), ('returnvalue',)], len(asm.decode(e.body(label)[5])))
    return result
