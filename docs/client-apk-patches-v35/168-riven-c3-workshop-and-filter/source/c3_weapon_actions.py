"""Category navigation, guarded actions and existing C2 detail entry."""
import asm
from c1_lookup import number, lookup
from c2_common import DYNAMIC, OPTION, get, set_, prefix, queue
from c3_weapon_common import TOGGLE, FILTER, ROW_DOMAIN, mode, refresh, safe_buttons, row_guard


def click(e, first):
    q = e.q
    enabled = first
    # The existing right top how-to resource becomes the category switch.
    code = [('getlocal_1',), number(e, TOGGLE), ('ifne', 'not_toggle'),
            ('getlocal_0',), ('getproperty', q('filterSetting')), *get(e, 'wfxRiven'),
            ('not',), ('setlocal', enabled),
            ('getlocal_0',), ('getproperty', q('bulkSelector')),
            ('callpropvoid', q('deselectAll'), 0), ('getlocal_0',),
            ('getlex', q('pinball.scene.equipmentList::EquipmentListCheckButtonStatus')),
            ('getproperty', q('Normal')), ('setproperty', q('checkButtonStatus')),
            ('getlocal_0',), ('getproperty', q('bulkSelectButton')), ('pushfalse',),
            ('setproperty', q('checked')), ('getlocal_0',),
            ('getlex', q('pinball.common.data.item.repository::EquipmentFilterSettingTools')),
            ('callproperty', q('getOrigin'), 0), ('setproperty', q('filterSetting')),
            ('getlocal_0',), ('getproperty', q('filterSetting')),
            *set_(e, 'wfxRiven', [('getlocal', enabled)]),
            *safe_buttons(e, [('getlocal', enabled), ('not',)]),
            ('getlocal_0',), ('getproperty', q('buttonGroup')), number(e, TOGGLE),
            ('callproperty', q('get'), 1), ('getlex', q(OPTION)),
            ('getlocal', enabled), ('iffalse', 'label_equipment'),
            e.string('裂罅 → 装备'), ('jump', 'label_set'), ('label', 'label_equipment'),
            e.string('装备 → 裂罅'), ('label', 'label_set'), ('callproperty', q('Some'), 1),
            ('setproperty', q('labelText')), *refresh(e), ('returnvoid',),
            ('label', 'not_toggle'), *row_guard(e, [('getlocal_1',)], 'not_row'),
            *mode(e, 'drop'), ('getlocal_0',), ('getlocal_1',),
            ('callpropvoid', q('openDetailDialog'), 1), ('returnvoid',),
            ('label', 'not_row'), *mode(e, 'original'),
            ('getlocal_1',), number(e, FILTER), ('ifeq', 'original'),
            ('label', 'drop'), ('returnvoid',), ('label', 'original')]
    return code


def detail(e, first):
    q = e.q
    ident, scratch, record = range(first, first + 3)
    code = row_guard(e, [('getlocal_1',)], 'original')
    code += [('getlocal_1',), number(e, 0xFFFFFF), ('bitand',), ('setlocal', ident)]
    code += lookup(e, ident, scratch, record, 'stale')
    code += [('getlocal_0',), ('getlex', q('pinball.dialog.item::AbilitySoulDetailDialog')),
             ('getlex', q('pinball.common.data.item::GeneralAbilitySoulLogic')),
             ('getlocal', ident), ('getlocal_0',), ('getproperty', q('globalLogic')),
             ('callproperty', q('getLogicAssets'), 0), ('construct', 2),
             ('getlex', q('pinball.common.tools::FunctionTools')),
             ('getproperty', q('emptyFunction0')),
             ('getlex', q('pinball.common.tools::FunctionTools')),
             ('getproperty', q('emptyFunction0')), ('construct', 3),
             ('callpropvoid', q('openDialog'), 1), ('label', 'stale'),
             ('returnvoid',), ('label', 'original')]
    return code


def no_bulk(e, first):
    return mode(e, 'original') + [('returnvoid',), ('label', 'original')]


def queue_actions(e):
    result = {}
    funcs = [('buttonClicked', click), ('openDetailDialog', detail)]
    funcs += [(name, no_bulk) for name in ('checkButtonClicked', 'changeProtection',
               'selectEquipment', 'openBulkSellDialog', 'bulkSellDialogHandler',
               'bulkUpgradeDialogHandler')]
    for name, fn in funcs:
        label = 'EquipmentListScene/' + name
        result[label] = prefix(e, label, fn)
    label = 'EquipmentListView/setupHowToButton'
    ops = asm.decode(e.body(label)[5])
    points = [i for i, op in enumerate(ops)
              if op.name == 'getproperty' and e.abc.mn_name(op.args[0]) == 'howToPlay']
    assert len(points) == 1
    # Replace the value left by the original config read, preserving all layout
    # and touch-region setup. The new label is literal, so no master asset changes.
    result[label] = queue(e, label, [('pop',),
        ('getlex', e.q('pinball.ui.component.button.config::ButtonConfigs')),
        e.string('装备 → 裂罅'), ('callproperty', e.q('positiveWithCustomString'), 1)],
        points[0] + 1, asm.ENTER)
    return result
