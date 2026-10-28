"""Owned weapon detail entry into the existing riven equipment-list category."""
import asm
from c1_lookup import number
from c2_common import DYNAMIC, OPTION, get, set_, queue

ENTRY_DOMAIN = 0x0C000000
PIN = 'wfxRivenWeaponId'


def detail_entry(e, first):
    weapon, cards, ident, record, count, transition, callback = range(first, first + 7)
    g = lambda n: ('getlocal', n)
    p = lambda n: ('setlocal', n)
    gp = lambda n: ('getproperty', e.q(n))
    cl = lambda n: ('getlex', e.q(n))
    call = lambda n, c: ('callproperty', e.q(n), c)
    n = lambda value: number(e, value)
    return [('getlocal_0',), gp('equipment'), gp('id'), p(weapon), n(0), p(count),
            ('getlocal_0',), gp('globalLogic'), call('get_player', 0), gp('saveData'),
            *get(e, 'weapon_rivens'), p(cards), g(cards), ('iffalse', 'counted'),
            n(16000001), p(ident), ('label', 'count_loop'), ('avm_label',),
            g(ident), n(16000999), ('ifgt', 'counted'),
            g(cards), g(ident), ('getproperty', DYNAMIC), p(record),
            g(record), ('iffalse', 'next_card'), g(record), *get(e, 'weapon_id'),
            g(weapon), ('ifne', 'next_card'), ('inclocal_i', count),
            ('label', 'next_card'), ('inclocal_i', ident), ('jump', 'count_loop'),
            ('label', 'counted'), cl('pinball.common.data.scene::TransitionKind'),
            cl('pinball.common.data.scene::SceneKind'), n(0), cl(OPTION),
            n(ENTRY_DOMAIN), g(weapon), ('bitor',), call('Some', 1),
            call('EquipmentList', 2), call('SimpleOut', 1), p(transition),
            cl('pinball.common.tools._FunctionTools::BindImpl1_0'), ('getlocal_0',),
            gp('logicScene'), gp('changeSceneWithPushBackScene'), g(transition),
            ('construct', 2), gp('execute'), p(callback),
            ('getlocal_0',), gp('contents'), cl('pinball.dialog.general::DialogContent'),
            e.string('config'), cl('pinball.ui.component.button.config::ButtonConfigs'),
            e.string('该武器的裂罅 '), g(count), ('add',), e.string(' 张'), ('add',),
            call('positiveWithCustomString', 1), e.string('handler'), g(callback),
            e.string('enable'), cl('pinball.common.tools::FunctionTools'), gp('returnTrue'),
            ('newobject', 3), call('SingleButton', 1),
            ('callpropvoid', e.q('http://adobe.com/AS3/2006/builtin::push'), 1)]


def scene_entry(e, first):
    ident = first
    gp = lambda n: ('getproperty', e.q(n))
    n = lambda value: number(e, value)
    return [('getlocal_2',), gp('index'), n(0), ('ifne', 'done'),
            ('getlocal_2',), gp('params'), n(0), ('getproperty', DYNAMIC), ('setlocal', ident),
            ('getlocal', ident), n(0xFF000000), ('bitand',), n(ENTRY_DOMAIN), ('ifne', 'done'),
            ('getlocal', ident), n(0xFFFFFF), ('bitand',), ('setlocal', ident),
            ('getlocal_0',), gp('filterSetting'), *set_(e, 'wfxRiven', [('pushtrue',)]),
            ('getlocal_0',), gp('filterSetting'), *set_(e, PIN, [('getlocal', ident)]),
            ('getlocal_0',), gp('filterSetting'), *set_(e, 'keywordSearchText', [
                ('getlex', e.q(OPTION)), ('getlocal_0',), gp('globalLogic'), ('getlocal', ident),
                ('callproperty', e.q('getGeneralEquipment'), 1), ('callproperty', e.q('get_name'), 0),
                ('callproperty', e.q('Some'), 1)]),
            ('getlocal_0',), ('getlex', e.q(OPTION)), gp('None'),
            ('setproperty', e.q('initialOpenId')), ('label', 'done')]


def preserve_filter(e, first):
    old, pin, keyword = range(first, first + 3)
    g = lambda n: ('getlocal', n)
    p = lambda n: ('setlocal', n)
    gp = lambda n: ('getproperty', e.q(n))
    # Keyword editing clears the exact-ID constraint. Other filter changes retain it.
    return [('getlocal_0',), gp('filterSetting'), p(old), g(old), *get(e, PIN), p(pin),
            g(pin), ('iffalse', 'done'), ('getlocal_1',), *get(e, 'keywordSearchText'), p(keyword),
            g(keyword), gp('index'), number(e, 0), ('ifne', 'done'),
            g(old), *get(e, 'keywordSearchText'), gp('index'), number(e, 0), ('ifne', 'done'),
            g(keyword), gp('params'), number(e, 0), ('getproperty', DYNAMIC),
            g(old), *get(e, 'keywordSearchText'), gp('params'), number(e, 0),
            ('getproperty', DYNAMIC), ('ifne', 'done'),
            ('getlocal_1',), *set_(e, PIN, [g(pin)]), ('label', 'done')]


def queue_entry(e):
    result = {}
    label = 'OwnedEquipmentDetailWithProtectionDialog/initialize'
    ops = asm.decode(e.body(label)[5]); assert ops[-1].name == 'returnvoid'
    result[label] = queue(e, label, detail_entry(e, e.body(label)[2]), len(ops) - 1)
    label = 'EquipmentListScene/<ctor>'
    ops = asm.decode(e.body(label)[5])
    points = [i + 1 for i, op in enumerate(ops) if op.name == 'initproperty'
              and e.abc.mn_name(op.args[0]) == 'filterSetting']
    assert len(points) == 1
    result[label] = queue(e, label, scene_entry(e, e.body(label)[2]), points[0])
    label = 'EquipmentListScene/getFilteredEquipmentList'
    ops = asm.decode(e.body(label)[5])
    at = next(i for i, op in enumerate(ops) if op.name == 'getlocal_0' and i > 30)
    assert at == 34 and ops[at - 1].name == 'iffalse'
    # Reuse the original null-record skip branch by inserting a second predicate
    # immediately before it; the stack contains the resolved record's truth value.
    first = e.body(label)[2]
    code = [('getlocal_0',), ('getproperty', e.q('filterSetting')), *get(e, PIN),
            ('setlocal', first), ('getlocal', first), ('iffalse', 'unfiltered'),
            ('pop',), ('getlocal', 10), *get(e, 'weapon_id'), ('getlocal', first),
            ('equals',), ('label', 'unfiltered')]
    # iffalse #33 handles null and exact-ID mismatch; do not read a null record.
    code = [('dup',), ('iffalse', 'null_record'), *code, ('label', 'null_record')]
    result[label] = queue(e, label, code, at - 1)
    label = 'EquipmentListScene/filterDialogOkHandler'
    result[label] = queue(e, label, preserve_filter(e, e.body(label)[2]), 2)
    return result
