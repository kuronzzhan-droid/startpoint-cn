"""C7 category button: reuse the filter-size circle and keep text inside it."""
import asm
from c1_lookup import number
from c2_common import DYNAMIC, OPTION, get, prefix, queue
from c3_weapon_common import TOGGLE

MARKER = 'wfxRivenSwitch'
CIRCLE = 'pinball.ui.component.button::CircleButtonView'
ASSET = 'scene/equipment_list/equipment_list_scene'


def replacement(e, first):
    q = e.q
    g = lambda n: ('getlocal', n)
    code = [('getlocal_0',), ('getproperty', q('uiProvider')),
            e.string('assetPath'), e.string(ASSET), e.string('name'),
            e.string('layout/container/button'), ('newobject', 2),
            ('callproperty', q('pinball.ui.provider:UiProvider::build'), 1),
            ('coerce', q('pinball.ui.display::UiDisplayObjectContainer')),
            ('setlocal', first)]
    for prop, value in [('x', 984), ('y', 201)]:
        code += [g(first), number(e, value), ('setproperty', q(prop))]
    code += [('getlocal_2',), g(first), ('callpropvoid', q('addChild'), 1),
             ('getlocal_0',), ('getproperty', q('buttonGroupView')), number(e, TOGGLE),
             g(first), g(first), e.string('area'), ('pushnull',),
             ('callproperty', q('getGuideRectangle'), 2),
             ('getlex', q('pinball.ui.component.button.config.core::ButtonConfig')),
             e.string('background'), e.string('parent'),
             ('getlex', q('pinball.ui.component.button.config.preset::ButtonBackgroundDefaultConfigs')),
             ('getproperty', q('circleWhiteColor')), ('newobject', 1),
             e.string('content'), e.string('parent'),
             ('getlex', q('pinball.ui.component.button.config.preset::ButtonContentDefaultConfigs')),
             ('getproperty', q('circle')),
             e.string('stringKey'), e.string('equipment_list_footer_upgrade_button'),
             e.string('textSize'), number(e, 36),
             e.string(MARKER), ('pushtrue',), ('newobject', 4),
             ('newobject', 2), ('callproperty', q('Circle'), 1),
             ('callpropvoid', q('addWithConfig'), 4), ('jump', 'END')]
    return code


def internal_label(e, first):
    """Only the marked Circle redirects its existing label-state to internal text."""
    q = e.q
    circle, text = first, first + 1
    g = lambda n: ('getlocal', n)
    code = [('getlocal_0',), ('astype', q(CIRCLE)), ('setlocal', circle),
            g(circle), ('iffalse', 'original'), g(circle),
            ('getproperty', q('contentParameter')), *get(e, MARKER),
            ('iffalse', 'original'),
            ('getlocal_0',), ('getlocal_1',), ('setproperty', q('currentLabelText')),
            g(circle), ('getproperty', q('contentView')), ('getproperty', q('textImage')),
            ('getproperty', q('params')), number(e, 0), ('getproperty', DYNAMIC),
            ('coerce', q('starling.text::TextField')), ('setlocal', text),
            g(text), ('getlocal_1',), ('getproperty', q('index')), number(e, 0),
            ('ifne', 'initial'), ('getlocal_1',), ('getproperty', q('params')),
            number(e, 0), ('getproperty', DYNAMIC), ('jump', 'set_text'),
            ('label', 'initial'), e.string('裂罅'), ('label', 'set_text'),
            ('setproperty', q('text'))]
    # A fixed, centered field is measured inside the 128x128 native circle.
    # Native autoScale handles the actual font metrics rather than guessing width.
    for prop, value in [('autoSize', e.string('none')), ('width', number(e, 96)),
                        ('height', number(e, 48)), ('x', ('pushbyte', 208)),
                        ('y', ('pushbyte', 232)), ('autoScale', ('pushtrue',))]:
        code += [g(text), value, ('setproperty', q(prop))]
    code += [('getlocal_0',), ('getproperty', q('textLabelLayer')),
             ('pushfalse',), ('setproperty', q('visible')),
             ('returnvoid',), ('label', 'original')]
    return code


def queue_button(e):
    label = 'EquipmentListView/setupHowToButton'
    ops = asm.decode(e.body(label)[5])
    assert len(ops) == 631
    assert ops[250].name == 'pushint' and e.abc.ints[ops[250].args[0]] == TOGGLE
    assert ops[252].name == 'pushstring' and e.abc.strings[ops[252].args[0]].decode('utf-8') == 'how_to_button'
    assert ops[295].name == 'callpropvoid' and e.abc.mn_name(ops[295].args[0]) == 'addWithConfig'
    assert ops[296].name == 'findproperty'
    result = {label: queue(e, label, replacement(e, e.body(label)[2]), 248)}
    # Retain the inherited registration bytes for exact unsplice recovery, but
    # branch over all of them so neither the small layout nor Box config executes.
    block = e.insertions[label][-1][1]
    assert block[-1].name == 'jump' and block[-1].target == len(block)
    block[-1].target += 296 - 248
    result[label]['bypassed_original_instructions'] = [248, 296]
    for owner, expected in [('EquipmentListScene/buttonClicked', 2), ('EquipmentListScene/run', 1)]:
        points = [(i, e.abc.strings[o.args[0]].decode('utf-8', errors='replace')) for i,o in enumerate(asm.decode(e.body(owner)[5]))
                  if o.name == 'pushstring' and e.abc.strings[o.args[0]].decode('utf-8', errors='replace') in ('装备 → 裂罅', '裂罅 → 装备')]
        assert len(points) == expected, (owner, points)
        result[owner] = [queue(e, owner, [('pop',), e.string('装备' if old.startswith('裂罅') else '裂罅')], i + 1, incoming=asm.SKIP)
                         for i,old in points]
    result['ButtonViewBase/setTextLabel'] = prefix(e, 'ButtonViewBase/setTextLabel', internal_label)
    return {'methods': result, 'resource': ASSET + ':layout/container/button',
            'config': 'Circle(circleWhiteColor, circle)', 'marker': MARKER,
            'local_button_bounds': [920,137,1048,265], 'local_text_bounds': [936,177,1032,225],
            'safe_area_alignment': 'original align_right x += safeArea.right - 1080; y += safeArea.y',
            'label_target_equipment_mode': '裂罅', 'label_target_riven_mode': '装备',
            'original_how_to_registration_unreachable': True, 'new_art_assets': 0}



