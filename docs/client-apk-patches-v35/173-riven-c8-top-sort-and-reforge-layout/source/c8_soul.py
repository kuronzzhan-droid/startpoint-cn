"""C8 soul category switching through existing scene, button and list methods."""
import asm
from c1_lookup import number
from c2_common import DYNAMIC, OPTION, get, set_, queue, prefix
from c8_soul_layout import queue_layout
from c8_soul_button import button

TOGGLE = 0x06000000
MODE = 'wfxSoulRiven'
ROW = 'wfxSoulRivenRow'


def label(e, enabled):
    q = e.q
    return [('getlocal_0',), ('getproperty', q('buttonGroup')), number(e, TOGGLE),
            ('callproperty', q('get'), 1), ('getlex', q(OPTION)), *enabled,
            ('iffalse', 'label_normal'), e.string('常规'), ('jump', 'label_set'),
            ('label', 'label_normal'), e.string('裂罅'), ('label', 'label_set'),
            ('callproperty', q('Some'), 1), ('setproperty', q('labelText'))]


def initialize(e, first):
    q = e.q
    current, ident, enabled = range(first, first + 3)
    g = lambda n: ('getlocal', n)
    return [('pushfalse',), ('setlocal', enabled), ('getlocal_0',),
            ('getproperty', q('party')), ('getlocal_0',), ('getproperty', q('characterIndex')),
            ('callproperty', q('getAbilitySoul'), 1), ('setlocal', current),
            g(current), ('getproperty', q('index')), number(e, 0), ('ifne', 'ready'),
            g(current), ('getproperty', q('params')), number(e, 0), ('getproperty', DYNAMIC),
            ('callproperty', q('get_abilitySoulId'), 0), ('setlocal', ident),
            g(ident), number(e, 16000000), ('iflt', 'ready'),
            g(ident), number(e, 16000999), ('ifgt', 'ready'),
            ('pushtrue',), ('setlocal', enabled), ('label', 'ready'),
            ('getlocal_0',), ('getproperty', q('filterSetting')), *set_(e, MODE, [g(enabled)]),
            ('getlocal_0',), ('getproperty', q('buttonGroup')), number(e, TOGGLE),
            ('callpropvoid', q('append'), 1), *label(e, [g(enabled)])]


def click(e, first):
    q = e.q
    return [('getlocal_1',), number(e, TOGGLE), ('ifne', 'original'),
            ('getlocal_0',), ('getproperty', q('filterSetting')), *get(e, MODE),
            ('not',), ('setlocal', first), ('getlocal_0',), ('getproperty', q('filterSetting')),
            *set_(e, MODE, [('getlocal', first)]), *label(e, [('getlocal', first)]),
            ('getlocal_0',), ('getproperty', q('viewSceneOrder')),
            ('callpropvoid', q('pinball.scene.abilitySoulList:AbilitySoulListViewOrder::stopBuildThumbnails'), 0),
            ('getlocal_0',), ('callpropvoid', q('didChangeViewScene'), 0),
            ('returnvoid',), ('label', 'original')]


def filter_rows(e, first):
    q = e.q
    out, index, row, info, ident, is_riven, enabled = range(first, first + 7)
    g = lambda n: ('getlocal', n)
    p = lambda n: ('setlocal', n)
    return [('newarray', 0), p(out), ('getlocal_0',), ('getproperty', q('filterSetting')),
            *get(e, MODE), ('convert_b',), p(enabled), number(e, 0), p(index),
            ('label', 'loop'), ('avm_label',), g(index), ('getlocal_1',),
            ('getproperty', q('length')), ('ifge', 'done'),
            ('getlocal_1',), g(index), ('getproperty', DYNAMIC), p(row),
            g(row), ('getproperty', q('kind')), ('getproperty', q('index')),
            number(e, 0), ('ifne', 'append'),
            g(row), ('getproperty', q('kind')), ('getproperty', q('params')),
            number(e, 0), ('getproperty', DYNAMIC), p(info),
            g(info), ('getproperty', q('itemId')), p(ident), ('pushfalse',), p(is_riven),
            g(ident), number(e, 16000000), ('iflt', 'classified'),
            g(ident), number(e, 16000999), ('ifgt', 'classified'), ('pushtrue',), p(is_riven),
            ('label', 'classified'), g(is_riven), g(enabled), ('ifne', 'next'),
            g(info), *set_(e, ROW, [g(enabled)]),
            ('label', 'append'), g(out), g(row),
            ('callpropvoid', q('http://adobe.com/AS3/2006/builtin::push'), 1),
            ('label', 'next'), ('inclocal_i', index), ('jump', 'loop'),
            ('label', 'done'), g(out), ('setlocal_1',)]


def keep_mode(e, first):
    return [('getlocal_1',), *set_(e, MODE, [('getlocal_0',),
            ('getproperty', e.q('filterSetting')), *get(e, MODE)])]


def queue_soul(e):
    result = {}
    for owner, name, builder, tail in [
            ('AbilitySoulListScene', 'run', initialize, True),
            ('AbilitySoulListScene', 'abilitySoulClicked', click, False),
            ('AbilitySoulListScene', 'showThumbnails', filter_rows, False),
            ('AbilitySoulListScene', 'filterDialogOkHandler', keep_mode, False),
            ('AbilitySoulListView', 'setupButton', button, True)]:
        target = owner + '/' + name
        body = e.body(target)
        if tail:
            ops = asm.decode(body[5]); assert ops[-1].name == 'returnvoid'
            result[target] = queue(e, target, builder(e, body[2]), len(ops) - 1)
        else:
            result[target] = prefix(e, target, builder)
    result.update(queue_layout(e))
    return {'methods': result, 'toggle_key': TOGGLE, 'state_owner': 'scene.filterSetting.' + MODE,
            'normal_default': True, 'equipped_riven_default': True,
            'equipped_character_key_domain_unchanged': '0x02000000',
            'physical_riven_columns': 1, 'button_label_targets': ['常规', '裂罅'],
            'public_button_base_unchanged': True, 'new_art_assets': 0}
