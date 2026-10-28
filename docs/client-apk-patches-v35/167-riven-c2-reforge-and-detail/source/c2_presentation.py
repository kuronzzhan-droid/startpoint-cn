"""Presentation entry point plus reusable inline UI instructions."""
import asm
from c2_common import context, get, queue, DYNAMIC, OPTION
from c1_lookup import number
from c2_cutin import queue_cutin_splices


def global_logic(e):
    return [('getlex', e.q('PinballClientMain')), ('getproperty', e.q('top')),
            ('getproperty', e.q('logic')), ('getproperty', e.q('globalLogic'))]


def equipment(e, ctx):
    return [*global_logic(e), ('getlocal', ctx), *get(e, 'record'), *get(e, 'weapon_id'),
            ('convert_i',), ('callproperty', e.q('getGeneralEquipment'), 1)]


def title(e, ctx):
    return [*equipment(e, ctx), ('callproperty', e.q('get_name'), 0), e.string('裂罅'), ('add',)]


def container(e, local, *names):
    code = [('getlocal', local)]
    for name in names:
        code += [e.string(name), ('callproperty', e.q('getContainer'), 1)]
    return code


def text(e, local, path, name, value):
    return [*container(e, local, *path), e.string(name),
            ('callproperty', e.q('getText'), 1), *value,
            ('callpropvoid', e.q('set_text'), 1)]


def thumbnail(e, ctx, holder, first, x=None, y=None, scale=1):
    """Build a managed weapon thumbnail using the game's existing async loader."""
    eq, image = first, first + 1
    code = [*equipment(e, ctx), ('setlocal', eq),
            ('getlex', e.q('pinball.ui.component.item::ItemThumbnailView')), *holder,
            ('getlex', e.q(OPTION)), ('getlocal', eq),
            ('callproperty', e.q('get_pixelArtPath'), 0), ('callproperty', e.q('Some'), 1),
            ('getlex', e.q(OPTION)), ('getlocal', eq),
            ('callproperty', e.q('get_rarity'), 0), ('callproperty', e.q('Some'), 1),
            ('construct', 3), ('setlocal', image), ('getlocal_0',),
            ('getproperty', e.q('gear')), ('getlocal', image), ('pushnull',),
            ('callpropvoid', e.q('addChild'), 2)]
    for prop, value in [('set_x', x), ('set_y', y), ('set_scale', [number(e, scale)])]:
        if value is not None:
            code += [('getlocal', image), *value, ('callpropvoid', e.q(prop), 1)]
    return code


def queue_cutin_view(e):
    label = 'ExBoostCutinView/run'
    body = e.body(label)
    ops = asm.decode(body[5])
    assert ops[125].name == 'findpropstrict'
    assert e.abc.mn_name(ops[125].args[0]).endswith('::FullShotCharacterViewAssetContainer')
    # Rows are constructed before this point. In riven mode omit all full-shot
    # construction/loading, add weapon thumbnail, and reuse the exact cover tail.
    assert ops[277].name == 'findproperty' and ops[-1].name == 'returnvoid'
    ctx, layout = body[2], body[2] + 1
    code = context(e, ctx, 'cutin_view_original')
    code += [('getlocal_0',), ('getproperty', e.q('exBoostCutinLayout')), ('setlocal', layout)]
    code += thumbnail(e, ctx, container(e, layout, 'character_image_holder'), body[2] + 2,
                      x=[number(e, 0)], y=[number(e, 160), ('negate_i',)], scale=2)
    assert all(op.target is None and op.cases is None for op in ops[277:])
    code += [(op.name, *op.args) for op in ops[277:]]
    code += [('label', 'cutin_view_original')]
    return queue(e, label, code, 125)


def queue_presentation_splices(e):
    from c2_presentation_dialogs import queue_dialog_splices
    result = queue_cutin_splices(e)
    result['ExBoostCutinView/run'] = queue_cutin_view(e)
    result.update(queue_dialog_splices(e))
    return result
