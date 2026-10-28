"""C13 presentation entry point: reversible single-method blocks only."""
import asm
from c2_common import queue
from c13_layout_controls import setup
from c13_layout_page import initialize, geometry
from c13_layout_text import queue_text, restore_page_title
from c13_layout_dialog import apply as dialog
from c13_layout_scroll import apply as scroll


def apply(editor):
    result = {}
    label = 'ExBoostWindowView/setupButtons'
    result[label] = queue(editor, label, setup(editor, editor.body(label)[2]))
    label = 'ExBoostWindowView/setupExBoostInformationWindow'
    result[label] = {'width': queue(editor, label, initialize(editor, editor.body(label)[2]))}
    label = 'ExBoostWindowView/draw'; body = editor.body(label)
    result[label] = queue(editor, label, geometry(editor, body[2], 'c13_draw', refresh=False), len(asm.decode(body[5])) - 1)
    label = 'ExBoostWindowView/onApplyExBoostInformation'; body = editor.body(label); ops = asm.decode(body[5])
    # C2 returns early on the Riven path. Reflow before its native refresh reads
    # the guide rectangle, not after a refresh with stale viewport dimensions.
    at = next(i for i, op in enumerate(ops) if op.name == 'callpropvoid'
              and editor.abc.mn_name(op.args[0]) == 'refreshExAbilitiesScrollArea')
    result[label] = {'geometry': queue(editor, label, geometry(editor, body[2], 'c13_apply'), at, asm.SKIP),
                     'ordinary_restore': queue(editor, label, restore_page_title(editor, body[2] + 20))}
    result.update(queue_text(editor)); result.update(dialog(editor)); result.update(scroll(editor))
    return {'methods': result, 'native_button_ids': [33554432, 150994944, 167772160, 184549376],
            'page_width': 'safeArea.width - 64; 32px symmetric margins',
            'page_viewport': 'min(actual final row bottom + 16, max(160, safeArea.height - 896)); floor 80',
            'selection_viewports': 'each independently min(460,max(140,detail.get_height()+64)) - 8',
            'quality_colors': {'filled': '#bca700', 'empty': '#999999'},
            'font': 'existing default font; body32, annotation24, name40, quality28',
            'new_methods': 0, 'new_traits': 0, 'native_render_verified': False}
