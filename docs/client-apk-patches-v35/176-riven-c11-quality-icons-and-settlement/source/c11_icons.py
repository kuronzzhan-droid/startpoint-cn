"""C11 icon consumers use the item's own native thumbnail and rarity frame."""
import asm
from c2_common import get, queue
from c11_icons_emit import image, quality, source_image, source_quality
from c11_icons_emit import context_image, context_quality


def calls(e, ops, name):
    return [i for i, op in enumerate(ops) if op.name.startswith('call')
            and e.abc.mn_name(op.args[0]) == name]


def queue_icons(e):
    result = {}

    def patch(label, at, code, kind):
        row = queue(e, label, code, at, asm.SKIP)
        row['scratch_local_start'] = e.body(label)[2] + 20
        result.setdefault(label, {})[kind] = row

    label = 'EquipmentListTableItemView/apply'
    ops = asm.decode(e.body(label)[5]); first = e.body(label)[2] + 20
    path = calls(e, ops, 'get_pixelArtPath')
    assert len(path) == 1
    # Only the C3 dynamic-riven branch uses the unqualified native weapon call.
    patch(label, path[0] + 1, [('pop',), *image(e, [('getlocal_1',),
          *get(e, 'item_id')])], 'item_image')
    rarity = calls(e, ops, 'get_rarity')
    assert len(rarity) == 1
    patch(label, rarity[0] + 1, [('pop',), *quality(e, [('getlocal_1',),
          *get(e, 'record')], first, 'c11_weapon_quality')], 'quality_frame')

    for label in ('AbilitySoulThumbnailListRepository/translate',
                  'AbilitySoulDetailDialog/initialize'):
        ops = asm.decode(e.body(label)[5]); first = e.body(label)[2] + 20
        for method, emitter, kind in [('get_thumbnailId', source_image, 'item_image'),
                                      ('get_rarity', source_quality, 'quality_frame')]:
            points = calls(e, ops, method); assert len(points) == 1, (label, points)
            patch(label, points[0] + 1, emitter(e, first, 'c11_source_' + kind), kind)

    # Keep the inherited DTO key for compatibility; its value now comes from
    # getItem(context.item_id), exactly as the normal inventory does.
    for label in ('ExBoostWindow/getExBoostInformation',
                  'ExBoostSelectDialogView/run', 'ExBoostCutinView/run'):
        ops = asm.decode(e.body(label)[5]); first = e.body(label)[2] + 20
        points = calls(e, ops, 'get_pixelArtPath'); assert len(points) == 1
        patch(label, points[0] + 1, context_image(e, first, 'c11_context_image'), 'item_image')
        if label != 'ExBoostWindow/getExBoostInformation':
            points = calls(e, ops, 'get_rarity'); assert len(points) == 1
            patch(label, points[0] + 1, context_quality(e, first, 'c11_context_quality'), 'quality_frame')

    label = 'ExBoostWindowView/setupButtons'
    ops = asm.decode(e.body(label)[5]); first = e.body(label)[2] + 20
    point = next(i for i, op in enumerate(ops) if op.name == 'pushstring'
                 and e.abc.s(op.args[0]) == 'weaponImage')
    assert ops[point + 4].name == 'pushbyte' and ops[point + 4].args == [5]
    patch(label, point + 5, context_quality(e, first, 'c11_header_quality'), 'quality_frame')

    label = 'ExBoostWindowView/onApplyExBoostInformation'
    ops = asm.decode(e.body(label)[5]); first = e.body(label)[2] + 20
    points = calls(e, ops, 'replace'); assert len(points) == 1
    assert ops[points[0] - 1].name == 'pushbyte' and ops[points[0] - 1].args == [5]
    patch(label, points[0], context_quality(e, first, 'c11_refresh_quality'), 'quality_frame')
    return {'methods': result, 'image_source': 'globalLogic.getItem(item_id).get_thumbnailId()',
            'quality_frame': 'existing ThumbnailFrameView rarityBackground frames 1..5',
            'bound_weapon_overlay': False,
            'overlay_reason': 'Native element badges accept element enums; protection badges use a fixed atlas icon. '
                              'Neither is an arbitrary asynchronous equipment-thumbnail slot.',
            'new_art_assets': 0}
