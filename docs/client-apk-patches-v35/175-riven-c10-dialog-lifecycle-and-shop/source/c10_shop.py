"""C10 shop entry using existing menu row, enum and navigation contracts."""
import asm
from c1_lookup import number
from c2_common import DYNAMIC, OPTION, get, set_, queue
from c9_entry import PIN
from c10_strings import TEXT

ROW_MARKER = 'wfxRivenWorkshop'
LABEL_KEY = 'wfx_riven_workshop'
ALL_RIVENS = 0x0D000000
ICON = 'scene/general/sprite_sheet/pixelart_scale6-assets/boss_coin_shop'


def menu_row(e):
    q = e.q
    none = [('getlex', q(OPTION)), ('getproperty', q('None'))]
    # The source row is an anonymous newobject, as are all original menu rows.
    # Its kind and content remain real, existing enum instances.
    return [('getlocal_1',), e.string('kind'),
            ('getlex', q('pinball.ui.component.list.menu.data::ShopTopListItemKind')),
            ('getproperty', q('BossCoinExchange')), e.string('content'),
            ('getlex', q('pinball.ui.component.list.menu.data::MenuListContentKind')),
            e.string(ICON), e.string(LABEL_KEY), ('callproperty', q('IconAndText'), 2),
            e.string('price'), *none, e.string('open_time'), *none,
            e.string(ROW_MARKER), ('pushtrue',), ('newobject', 5),
            ('callpropvoid', q('http://adobe.com/AS3/2006/builtin::push'), 1)]


def selected(e):
    q = e.q
    return [('getlocal_1',), *get(e, ROW_MARKER), ('iffalse', 'original'),
            ('getlocal_0',), ('getlex', q('pinball.common.data.scene::TransitionKind')),
            ('getlex', q('pinball.common.data.scene::SceneKind')), number(e, 0),
            ('getlex', q(OPTION)), number(e, ALL_RIVENS),
            ('callproperty', q('Some'), 1), ('callproperty', q('EquipmentList'), 2),
            ('callproperty', q('BlackOut'), 1),
            ('callpropvoid', q('changeSceneWithPushBackScene'), 1),
            ('returnvoid',), ('label', 'original')]


def enabled(e):
    return [('getlocal_1',), *get(e, ROW_MARKER), ('iffalse', 'original'),
            ('getlex', e.q('pinball.ui.component.list.core.cell::CellEnabledState')),
            ('getproperty', e.q('Enabled')), ('returnvalue',), ('label', 'original')]


def label_text(e):
    # At this insertion the original UiText receiver is already on the stack.
    # Keep original pre-run deferred setText handling; skip localization lookup
    # only for the private key, which has no master/data-edge dependency.
    return [('getlocal_1',), e.string(LABEL_KEY), ('ifne', 'original'),
            e.string(TEXT['workshop']), ('callpropvoid', e.q('set_text'), 1),
            ('returnvoid',), ('label', 'original')]


def scene_entry(e):
    q = e.q
    gp = lambda name: ('getproperty', q(name))
    none = [('getlex', q(OPTION)), gp('None')]
    return [('getlocal_2',), gp('index'), number(e, 0), ('ifne', 'done'),
            ('getlocal_2',), gp('params'), number(e, 0), ('getproperty', DYNAMIC),
            number(e, ALL_RIVENS), ('ifne', 'done'),
            ('getlocal_0',), gp('filterSetting'), *set_(e, 'wfxRiven', [('pushtrue',)]),
            ('getlocal_0',), gp('filterSetting'), *set_(e, 'keywordSearchText', none),
            ('getlocal_0',), gp('filterSetting'), e.string(PIN),
            ('deleteproperty', DYNAMIC), ('pop',),
            ('getlocal_0',), *none, ('setproperty', q('initialOpenId')),
            ('label', 'done')]


def queue_shop(e):
    result = {}
    label = 'ShopTopScene/createMenuListData'
    ops = asm.decode(e.body(label)[5])
    # Immediately after the optional equipment enhancement row; the branch
    # which omits that row must enter this insertion as well.
    assert ops[372].name == 'getlocal_1'
    assert ops[375].name == 'getproperty' and e.abc.mn_name(ops[375].args[0]) == 'StarCrumbExchange'
    result[label] = queue(e, label, menu_row(e), 372)
    result['ShopTopScene/listSelected'] = queue(e, 'ShopTopScene/listSelected', selected(e))
    result['ShopTopScene/listCellEnabledResolver'] = queue(e, 'ShopTopScene/listCellEnabledResolver', enabled(e))
    label = 'MenuListCellContentView/setText'
    ops = asm.decode(e.body(label)[5])
    assert ops[26].name == 'callproperty' and e.abc.mn_name(ops[26].args[0]) == 'getText'
    assert ops[28].name == 'findproperty' and e.abc.mn_name(ops[28].args[0]) == 'view'
    result[label] = queue(e, label, label_text(e), 28)
    label = 'EquipmentListScene/<ctor>'
    ops = asm.decode(e.body(label)[5])
    points = [i + 1 for i, op in enumerate(ops) if op.name == 'initproperty'
              and e.abc.mn_name(op.args[0]) == 'filterSetting']
    assert points == [29]
    result[label] = queue(e, label, scene_entry(e), points[0])
    return {'methods': result, 'row_marker': ROW_MARKER, 'label_key': LABEL_KEY,
            'label': TEXT['workshop'], 'icon': ICON, 'initial_open_marker': ALL_RIVENS,
            'route': 'BlackOut(EquipmentList(0, Some(ALL_RIVENS))) via changeSceneWithPushBackScene',
            'category': 'all owned riven cards; no keyword or exact weapon constraint',
            'data_only_possible': False, 'new_methods': 0, 'new_traits': 0}
