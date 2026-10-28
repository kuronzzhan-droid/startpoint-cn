"""Reuse C7's short circle label treatment without another ButtonViewBase splice."""
from c1_lookup import number
from c7_button import ASSET, MARKER


def button(e, first):
    from c8_soul import TOGGLE
    q = e.q
    g = [('getlocal', first)]
    code = [('getlocal_0',), ('getproperty', q('uiProvider')), e.string('assetPath'),
            e.string(ASSET), e.string('name'), e.string('layout/container/button'),
            ('newobject', 2), ('callproperty', q('pinball.ui.provider:UiProvider::build'), 1),
            ('coerce', q('pinball.ui.display::UiDisplayObjectContainer')), ('setlocal', first)]
    # Original soul filter center is (984, 200); 176px separation preserves
    # the native +/-80px touch/pressed bounds with a 16px gap.
    for prop, value in [('x', 808), ('y', 200)]:
        code += [*g, number(e, value), ('setproperty', q(prop))]
    code += [('getlocal_0',), ('getproperty', q('layoutRoot')), *g,
             ('callpropvoid', q('addChild'), 1), ('getlocal_0',),
             ('getproperty', q('buttonGroupView')), number(e, TOGGLE), *g, *g,
             e.string('area'), ('pushnull',), ('callproperty', q('getGuideRectangle'), 2),
             ('getlex', q('pinball.ui.component.button.config.core::ButtonConfig')),
             e.string('background'), e.string('parent'),
             ('getlex', q('pinball.ui.component.button.config.preset::ButtonBackgroundDefaultConfigs')),
             ('getproperty', q('circleWhiteColor')), ('newobject', 1),
             e.string('content'), e.string('parent'),
             ('getlex', q('pinball.ui.component.button.config.preset::ButtonContentDefaultConfigs')),
             ('getproperty', q('circle')), e.string('stringKey'),
             e.string('equipment_list_footer_upgrade_button'), e.string('textSize'), number(e, 36),
             e.string(MARKER), ('pushtrue',), ('newobject', 4), ('newobject', 2),
             ('callproperty', q('Circle'), 1), ('callpropvoid', q('addWithConfig'), 4)]
    return code
