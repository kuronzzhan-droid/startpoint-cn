"""Render dynamic soul DTOs in the existing EX page; keep ordinary EX byte paths."""
import asm
from c2_common import DYNAMIC, MODE, OPTION, context, get, prefix, queue
from c1_lookup import number


def ui(e, source, names, leaf=None):
    code = list(source)
    for name in names:
        code += [e.string(name), ('pushnull',), ('callproperty', e.q('getContainer'), 2)]
    if leaf:
        code += [e.string(leaf), ('pushnull',), ('callproperty', e.q('getText'), 2)]
    return code


def panel(e, leaf=None):
    return ui(e, [('getlocal_0',), ('getproperty', e.q('uiLayout'))],
              ['bottom_left', 'ex_boost_panel'], leaf)


def apply_ability(e, first):
    q = e.q
    ctx, dto, icon = range(first, first + 3)
    code = context(e, ctx, 'ability_original') + [
        ('getlocal_1',), ('getproperty', q('index')), number(e, 0), ('ifne', 'ability_original'),
        ('getlocal_1',), ('getproperty', q('params')), number(e, 0), ('getproperty', DYNAMIC),
        ('coerce_a',), ('setlocal', dto), e.string('mode'), ('getlocal', dto), ('in',),
        ('iffalse', 'ability_original'), ('getlocal', dto), *get(e, 'mode'), e.string(MODE),
        ('ifne', 'ability_original'), ('getlocal_0',), ('getproperty', q('layout')),
        ('pushtrue',), ('setproperty', q('renderingEnabled')),
        ('getlocal_0',), ('getproperty', q('iconView')), ('getproperty', q('index')),
        number(e, 0), ('ifne', 'ability_new_icon'), ('getlocal_0',),
        ('getproperty', q('iconView')), ('getproperty', q('params')), number(e, 0),
        ('getproperty', DYNAMIC), ('getlocal', dto), *get(e, 'rarity'), ('convert_i',),
        ('callpropvoid', q('changeRarity'), 1), ('jump', 'ability_text'),
        ('label', 'ability_new_icon'), ('getlex', q('pinball.ui.component.expod::ExBoostRarityIconView'))]
    code += ui(e, [('getlocal_0',), ('getproperty', q('layout'))], ['icon'])
    code += [('getlocal', dto), *get(e, 'rarity'), ('convert_i',), ('construct', 2),
             ('setlocal', icon), ('getlocal_0',), ('getproperty', q('gear')),
             ('getlocal', icon), ('pushnull',), ('callpropvoid', q('addChild'), 2),
             ('getlocal', icon), number(e, 42), ('getlocal', icon),
             ('callproperty', q('get_width'), 0), ('divide',), ('callpropvoid', q('set_scale'), 1),
             ('getlocal_0',), ('getlex', q(OPTION)), ('getlocal', icon),
             ('callproperty', q('Some'), 1), ('setproperty', q('iconView')),
             ('label', 'ability_text')]
    code += ui(e, [('getlocal_0',), ('getproperty', q('layout'))], [], 'description')
    code += [('getlocal', dto), *get(e, 'description'), ('callpropvoid', q('set_text'), 1),
             ('getlocal_0',), ('pushtrue',), ('callpropvoid', q('setBorderVisible'), 1),
             ('getlocal_0',), ('callpropvoid', q('fitHeight'), 0), ('returnvoid',),
             ('label', 'ability_original')]
    return code


def header(e, info_local):
    g = lambda n: ('getlocal', n)
    code = panel(e, 'character_name') + [g(info_local), *get(e, 'characterName'),
                                       ('callpropvoid', e.q('set_text'), 1)]
    code += panel(e, 'label_now_status_ability') + [e.string('当前词条 · 已重抽 '),
             g(info_local), *get(e, 'record'), *get(e, 'roll_count'), ('convert_i',), ('add',),
             e.string(' 次'), ('add',), ('callpropvoid', e.q('set_text'), 1)]
    code += panel(e, 'label_item_select') + [e.string('下次费用：'), g(info_local),
             *get(e, 'record'), *get(e, 'next_cost'), ('convert_i',), ('add',),
             e.string(' 深渊币　余额：'), ('add',), g(info_local), *get(e, 'balance'),
             ('convert_i',), ('add',), ('callpropvoid', e.q('set_text'), 1)]
    code += panel(e, 'notify_no_ex_ability') + [('pushfalse',), ('setproperty', e.q('visible'))]
    return code


def apply_information(e, first):
    q = e.q
    ctx, index, row, y, rows = range(first, first + 5)
    code = context(e, ctx, 'view_original') + header(e, 1)
    code += [('getlocal_1',), *get(e, 'exAbilities'), ('setlocal', rows),
             number(e, 0), ('setlocal', index), number(e, 0), ('setlocal', y),
             ('label', 'view_loop'), ('avm_label',), ('getlocal', index), ('getlocal_0',),
             ('getproperty', q('informationAbilityViews')), ('getproperty', q('length')),
             ('ifge', 'view_done'), ('getlocal_0',), ('getproperty', q('informationAbilityViews')),
             ('getlocal', index), ('getproperty', DYNAMIC), ('setlocal', row),
             ('getlocal', index), ('getlocal', rows), ('getproperty', q('length')),
             ('ifge', 'view_hide'), ('getlocal', row), ('getlocal', y),
             ('callpropvoid', q('set_y'), 1), ('getlocal', row), ('getlex', q(OPTION)),
             ('getlocal', rows), ('getlocal', index), ('getproperty', DYNAMIC),
             ('callproperty', q('Some'), 1), ('callpropvoid', q('applyExAbility'), 1),
             ('getlocal', row), ('getlocal', index), number(e, 1), ('add_i',),
             ('getlocal', rows), ('getproperty', q('length')), ('lessthan',),
             ('callpropvoid', q('setBorderVisible'), 1), ('getlocal', row),
             ('callproperty', q('getBottomY'), 0), ('setlocal', y), ('jump', 'view_next'),
             ('label', 'view_hide'), ('getlocal', row), ('getlex', q(OPTION)),
             ('getproperty', q('None')), ('callpropvoid', q('applyExAbility'), 1),
             ('label', 'view_next'), ('inclocal_i', index), ('jump', 'view_loop'),
             ('label', 'view_done'), ('getlocal_0',), ('callpropvoid', q('refreshExAbilitiesScrollArea'), 0),
             ('returnvoid',), ('label', 'view_original')]
    return code


def setup_information(e, first):
    return context(e, first, 'view_done') + header(e, 1) + [
        ('getlocal_0',), ('getproperty', e.q('exBoostPixelArtCharacterView')),
        ('getproperty', e.q('layer')), ('pushfalse',), ('setproperty', e.q('visible')),
        ('label', 'view_done')]


def setup_buttons(e, first):
    q = e.q
    ctx, info, thumbnail = range(first, first + 3)
    code = context(e, ctx, 'view_done') + [
        ('getlocal_0',), ('getproperty', q('peek')), ('callproperty', q('getExBoostInformation'), 0),
        ('setlocal', info), ('getlocal_0',), ('getproperty', q('characterSelectButtonContainer')),
        ('pushfalse',), ('setproperty', q('touchable'))]
    for names in (['top_right'], ['bottom_center','inject_exp_button'],
                  ['bottom_center','over_limit_button'], ['bottom_center','mana_board_button']):
        code += ui(e, [('getlocal_0',), ('getproperty', q('uiLayout'))], names)
        code += [('pushfalse',), ('setproperty', q('visible'))]
    # A managed ItemThumbnailView supplies the normal asynchronous weapon asset
    # loading and disposal lifecycle. No image path or texture is fabricated.
    code += [('getlex', q('pinball.ui.component.item::ItemThumbnailView')),
             ('getlocal_0',), ('getproperty', q('characterSelectButtonContainer')),
             ('getlex', q(OPTION)), ('getlocal', info), *get(e, 'weaponImage'),
             ('callproperty', q('Some'), 1), ('getlex', q(OPTION)), number(e, 5),
             ('callproperty', q('Some'), 1), ('construct', 3), ('setlocal', thumbnail),
             ('getlocal_0',), ('getproperty', q('gear')), ('getlocal', thumbnail),
             ('pushnull',), ('callpropvoid', q('addChild'), 2),
             ('getlocal', thumbnail), number(e, 180), ('callpropvoid', q('set_x'), 1),
             ('getlocal', thumbnail), number(e, 180), ('callpropvoid', q('set_y'), 1),
             ('getlocal', thumbnail), number(e, 2), ('callpropvoid', q('set_scale'), 1),
             ('label', 'view_done')]
    return code


def hide_scene_elements(e, first):
    q = e.q
    code = context(e, first, 'view_done')
    for field in ('tabLayer','uiFullshotLayer','pixelArtCharacterBodyLayer',
                  'pixelArtElementRingLayer','uiMessageLayer'):
        code += [('getlocal_0',), ('getproperty', q(field)), ('pushfalse',),
                 ('setproperty', q('visible'))]
    return code + [('label', 'view_done')]


def hide_character_controls(e, first):
    q=e.q
    code=context(e,first,'view_done')
    for names in (['top_right'], ['bottom_center','inject_exp_button'],
                  ['bottom_center','over_limit_button'], ['bottom_center','mana_board_button']):
        code += ui(e,[('getlocal_0',),('getproperty',q('uiLayout'))],names)
        code += [('pushfalse',),('setproperty',q('visible'))]
    code += [('getlocal_0',),('getproperty',q('exBoostPixelArtCharacterView')),
             ('getproperty',q('layer')),('pushfalse',),('setproperty',q('visible')),
             ('getlocal_0',),('getproperty',q('characterSelectButtonContainer')),
             ('pushfalse',),('setproperty',q('touchable')),('label','view_done')]
    return code


def queue_suffix(e, label, builder):
    body = e.body(label)
    ops = asm.decode(body[5])
    returns = [i for i, op in enumerate(ops) if op.name == 'returnvoid']
    assert len(returns) == 1, label
    return queue(e, label, builder(e, body[2]), returns[0])


def queue_view(e):
    result = {'ExBoostInformationAbilityView/applyExAbility':
              prefix(e, 'ExBoostInformationAbilityView/applyExAbility', apply_ability),
              'ExBoostWindowView/onApplyExBoostInformation':
              prefix(e, 'ExBoostWindowView/onApplyExBoostInformation', apply_information)}
    for label, builder in [('ExBoostWindowView/setupExBoostInformationWindow', setup_information),
                           ('ExBoostWindowView/setupButtons', setup_buttons),
                           ('ExBoostWindowView/draw', hide_character_controls),
                           ('ExpodSceneView/draw', hide_scene_elements)]:
        result[label] = queue_suffix(e, label, builder)
    return result
