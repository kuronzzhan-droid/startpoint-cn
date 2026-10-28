"""Return descriptive content before any placeholder ability is constructed."""
from c1_lookup import number
from c2_common import DYNAMIC, get, prefix
from c9_actions_lock import find_record
from c10_strings import TEXT


def empty_detail(editor, first):
    ident, scratch, record, message, title, affixes = range(first, first + 6)
    q = editor.q
    g = lambda local: ('getlocal', local)
    p = lambda local: ('setlocal', local)
    code = [('getlocal_1',), ('getproperty', q('id')), p(ident),
            g(ident), number(editor, 16000000), ('iflt', 'c10_detail_original'),
            g(ident), number(editor, 16000999), ('ifgt', 'c10_detail_original'),
            g(ident), number(editor, 16000000), ('ifeq', 'c10_detail_unknown')]
    code += find_record(editor, ident, scratch, record, 'c10_detail_sync')
    code += [g(record), *get(editor, 'affixes'), p(affixes), g(affixes),
             ('iffalse', 'c10_detail_sync'), g(affixes), ('getproperty', q('length')),
             number(editor, 0), ('ifgt', 'c10_detail_original'),
             ('label', 'c10_detail_sync'), editor.string(TEXT['sync_detail']), p(message),
             editor.string(TEXT['revealed_name']), p(title), ('jump', 'c10_detail_content'),
             ('label', 'c10_detail_unknown'), editor.string(TEXT['unknown_detail']), p(message),
             editor.string(TEXT['unknown_name']), p(title), ('label', 'c10_detail_content'),
             ('getlocal_0',), ('getlex', q('pinball.dialog.general::DialogContent')),
             ('pushbyte', 236), ('callproperty', q('Margin'), 1),
             ('getlex', q('pinball.dialog.general::DialogContent')), g(title),
             ('callproperty', q('ItemTitle'), 1),
             ('getlex', q('pinball.dialog.general::DialogContent')), g(message),
             ('callproperty', q('DynamicText'), 1), ('newarray', 3),
             ('setproperty', q('contents')), ('returnvoid',), ('label', 'c10_detail_original')]
    return code


def queue_empty(editor):
    label = 'AbilitySoulDetailDialog/initialize'
    return {'method': label, 'insertion': prefix(editor, label, empty_detail),
            'unknown': TEXT['unknown_detail'], 'missing_record': TEXT['sync_detail'],
            'ability_content': 'absent for unknown, missing, null or empty-affix records',
            'ordinary_and_valid_record': 'complete C9 initialize body remains the original fallthrough'}
