"""C13 C8007 fix: soul category button uses its already-loaded scene layout."""
import asm
from c2_common import queue

SOUL_ASSET = 'scene/ability_board/ability_soul_list'
WRONG_ASSET = 'scene/equipment_list/equipment_list_scene'
LAYOUT = 'layout/container/button'


def apply(editor):
    label = 'AbilitySoulListView/setupButton'
    ops = asm.decode(editor.body(label)[5])
    found = [i for i, op in enumerate(ops) if op.name == 'pushstring'
             and editor.abc.strings[op.args[0]].decode('utf-8') == WRONG_ASSET]
    assert len(found) == 1, (label, found)
    at = found[0]
    assert ops[at - 1].name == 'pushstring'
    assert editor.abc.strings[ops[at - 1].args[0]] == b'assetPath'
    assert ops[at + 2].name == 'pushstring'
    assert editor.abc.strings[ops[at + 2].args[0]].decode('utf-8') == LAYOUT
    # Preserve all C12 bytes for audited unsplice recovery. The original value
    # never reaches UiProvider.build: replace only the value already on stack.
    change = queue(editor, label, [('pop',), editor.string(SOUL_ASSET)],
                   at + 1, incoming=asm.SKIP)
    assert not editor.new_methods and not editor.traits
    return {'methods': {label: change}, 'old_asset': WRONG_ASSET,
            'asset': SOUL_ASSET, 'layout': LAYOUT,
            'new_art_assets': 0, 'added_asset_loads': 0,
            'native_button_area': [-64, -64, 128, 128],
            'button_center': [808, 200], 'filter_center': [984, 200],
            'touch_bounds_at_1080': [728, 120, 888, 280],
            'filter_touch_gap': 16}
