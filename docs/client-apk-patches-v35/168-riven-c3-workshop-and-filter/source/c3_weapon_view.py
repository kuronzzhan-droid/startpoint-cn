"""Render instance DTOs before the equipment interface coercion."""
from c1_lookup import number
import asm
from c2_common import DYNAMIC, get, prefix, queue
from c3_weapon_common import text, mode


def apply(e, first):
    q = e.q
    weapon, record = first, first + 1
    g = lambda n: ('getlocal', n)
    code = [('getlocal_1',), *get(e, 'wfxRiven'), ('iffalse', 'original'),
            ('getlocal_0',), ('getlocal_1',), ('setproperty', q('item')),
            ('getlocal_0',), ('getproperty', q('layout')), ('iffalse', 'done'),
            ('getlocal_1',), *get(e, 'weapon'), ('setlocal', weapon),
            ('getlocal_1',), *get(e, 'record'), ('setlocal', record),
            ('getlocal_0',), ('getproperty', q('thumbnailView')),
            g(weapon), ('callproperty', q('get_pixelArtPath'), 0),
            g(weapon), ('callproperty', q('get_rarity'), 0), ('pushfalse',),
            g(weapon), ('getproperty', q('kind')), ('callpropvoid', q('showEquipment'), 4),
            ('getlocal_0',), ('getproperty', q('thumbnailView')), number(e, 1),
            ('callpropvoid', q('showStack'), 1),
            ('getlocal_0',), ('getproperty', q('thumbnailView')), ('pushfalse',),
            ('callpropvoid', q('setProtectionIconVisible'), 1),
            ('getlocal_0',), ('getproperty', q('thumbnailView')), ('pushfalse',),
            ('callpropvoid', q('select'), 1),
            ('getlocal_0',), ('getproperty', q('thumbnailView')),
            ('getlex', q('pinball.ui.component.item::ThumbnailLabelKind')),
            ('getproperty', q('Hide')), ('callpropvoid', q('showLabel'), 1)]
    code += text(e, 'lv_text', [('getlocal_1',), *get(e, 'name')])
    code += [('getlocal_0',), ('getproperty', q('layout')), e.string('lv_text'),
             ('pushnull',), ('callproperty', q('getText'), 2), ('pushtrue',),
             ('callpropvoid', q('set_autoScale'), 1)]
    code += text(e, 'hp_text', [e.string('词条 '), g(record), *get(e, 'affixes'),
                              ('getproperty', q('length')), ('add',), e.string(' 条'), ('add',)])
    code += text(e, 'attack_text', [e.string('重抽 '), g(record), *get(e, 'roll_count'),
                                  ('convert_i',), ('add',), e.string(' 次'), ('add',)])
    return code + [('label', 'done'), ('returnvoid',), ('label', 'original')]


def set_selected(e, first):
    return [('getlocal_0',), ('getproperty', e.q('item')), *get(e, 'wfxRiven'),
            ('iffalse', 'original'), ('returnvoid',), ('label', 'original')]


def queue_view(e):
    result = {f'EquipmentListTableItemView/{name}': prefix(e, f'EquipmentListTableItemView/{name}', fn)
            for name, fn in [('apply', apply), ('setSelected', set_selected)]}
    label = 'EquipmentListView/setupPanelList'
    ops = asm.decode(e.body(label)[5])
    points = [i for i, op in enumerate(ops) if op.name == 'callpropvoid'
              and e.abc.mn_name(op.args[0]) == 'showEmptyStatePlaceholder']
    assert len(points) == 1
    q = e.q
    code = mode(e, 'empty_done', [('getlocal_0',), ('getproperty', q('peek')),
                                ('getproperty', q('filterSetting'))])
    code += [('getlocal_0',), ('getproperty', q('templateView')),
             ('getproperty', q('emptyStatePlaceholder')), ('getproperty', q('params')),
             number(e, 0), ('getproperty', DYNAMIC),
             e.string('暂无符合条件的已揭示裂罅'), ('callpropvoid', q('set_text'), 1),
             ('label', 'empty_done')]
    result[label] = queue(e, label, code, points[0] + 1)
    return result
