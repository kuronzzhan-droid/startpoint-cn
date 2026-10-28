"""C18 single revealed Riven per party, inline in existing selection methods."""
import asm
from c1_lookup import number
from c2_common import DYNAMIC, get, queue

MESSAGE = '每个队伍只能携带一张武器裂罅'
MIN_ID, MAX_ID, FRAGMENT_ID = 16000001, 16000999, 16000900
CLICK = 'AbilitySoulListScene/abilitySoulClicked'
USE = 'AbilitySoulListScene/useAbilitySoulHandler'
MOVE = 'AbilitySoulListScene/reuseAbilitySoulFromAnotherCharacterHandler'


def range_guard(e, ident, fail):
    g = lambda n: ('getlocal', n)
    return [g(ident), number(e, MIN_ID), ('iflt', fail),
            g(ident), number(e, MAX_ID), ('ifgt', fail),
            # Preserve the baseline numeric pool, including the fragment ID.
            g(ident), e.string(str(FRAGMENT_ID)), ('convert_i',), ('ifeq', fail)]


def guard(e, first, candidate, tag, source=None):
    """Read current native party slots and owned records before any mutation.

    candidate leaves an item ID. source, when provided, is a local containing
    the source slot that the original move handler will remove atomically.
    """
    ident, records, souls, index, slot, other = range(first, first + 6)
    q = e.q
    g = lambda n: ('getlocal', n)
    p = lambda n: ('setlocal', n)
    done, loop, skip = [tag + suffix for suffix in ('_original', '_loop', '_skip')]
    code = [*candidate, p(ident), *range_guard(e, ident, done),
            ('getlocal_0',), ('getproperty', q('player')), p(records),
            g(records), ('iffalse', done), g(records), ('getproperty', q('saveData')),
            p(records), g(records), ('iffalse', done), g(records), *get(e, 'weapon_rivens'),
            p(records), g(records), ('iffalse', done),
            g(records), g(ident), ('getproperty', DYNAMIC), ('iffalse', done),
            ('getlocal_0',), ('getproperty', q('party')),
            ('callproperty', q('get_abilitySoulIds'), 0), p(souls),
            number(e, 0), p(index), ('label', loop), ('avm_label',),
            g(index), g(souls), ('getproperty', q('length')), ('ifge', done),
            g(index), ('getlocal_0',), ('getproperty', q('characterIndex')), ('ifeq', skip)]
    if source is not None:
        code += [g(index), g(source), ('ifeq', skip)]
    code += [g(souls), g(index), ('getproperty', DYNAMIC), p(slot),
             g(slot), ('getproperty', q('index')), number(e, 0), ('ifne', skip),
             g(slot), ('getproperty', q('params')), number(e, 0),
             ('getproperty', DYNAMIC), p(other), *range_guard(e, other, skip),
             g(records), g(other), ('getproperty', DYNAMIC), ('iffalse', skip),
             ('getlocal_0',), ('getlex', q('pinball.dialog.general::OkDialog')),
             ('getlex', q('pinball.dialog.general::DialogContent')), e.string(MESSAGE),
             ('callproperty', q('DynamicText'), 1), ('newarray', 1),
             ('getlex', q('pinball.common.tools::FunctionTools')),
             ('getproperty', q('emptyFunction1')), ('construct', 2),
             ('callpropvoid', q('openDialog'), 1), ('returnvoid',),
             ('label', skip), ('inclocal_i', index), ('jump', loop), ('label', done)]
    return code


def apply(e):
    """Queue only method-body insertions against the sealed C17 anchors."""
    methods = {}
    body = e.body(CLICK)
    ops = asm.decode(body[5])
    assert ops[85].name == 'setlocal' and ops[85].args == [6]
    assert ops[86].name == 'findproperty' and e.abc.mn_name(ops[86].args[0]) == 'party'
    assert ops[241].name == 'findproperty' and e.abc.mn_name(ops[241].args[0]) == 'openDialog'
    candidate = [('getlocal', 6), ('callproperty', e.q('get_abilitySoulId'), 0)]
    methods[CLICK] = [
        queue(e, CLICK, guard(e, body[2], candidate, 'c18_choose'), 86),
        queue(e, CLICK, guard(e, body[2], candidate, 'c18_move_choose', source=11), 241),
    ]
    for label, ident, source in [(USE, 1, None), (MOVE, 2, 1)]:
        body = e.body(label)
        ops = asm.decode(body[5])
        assert [o.name for o in ops[:2]] == ['getlocal_0', 'pushscope']
        methods[label] = queue(e, label, guard(e, body[2], [('getlocal', ident)],
                                             'c18_apply_' + str(ident), source=source))
    assert not e.new_methods and not e.traits
    return {'methods': methods, 'message': MESSAGE, 'new_methods': 0, 'new_traits': 0,
            'scope': 'scene.party.get_abilitySoulIds; target slot excluded; move source excluded',
            'revealed': 'current player.saveData.weapon_rivens record and reserved range; fragment 16000900 excluded',
            'server_refresh': 'existing C4 parser/applyCommonResponse/TypePacker retained without modification'}
