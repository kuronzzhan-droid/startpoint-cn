"""P2 context fields on the existing shared BattleParty TypePacker schema."""
import asm
from bootstrap import sha
from c2_common import queue

FIELDS = {
    'weapon_riven_scope': 'String',
    'weapon_riven_snapshot_id': 'String',
    'weapon_riven_mode': 'Int',
    'weapon_riven_catalog': 'String',
    'weapon_riven_reason': 'String',
}
TARGETS = ('TypePackerResource2/resolveMap1471', 'TypePackerResource2/resolveMap2201')


def apply(editor):
    e, q = editor, editor.q
    label = TARGETS[0]
    body, code = e.body(label), []
    ops = asm.decode(body[5])
    assert ops[-1].name == 'returnvalue'
    assert [(o.name, o.args) for o in ops[-7:-5]] == [('getlocal_1', []), ('dup', [])]
    assert sum(o.name == 'pushstring' and e.abc.s(o.args[0]) == 'weapon_rivens' for o in ops) == 1
    for field, kind in FIELDS.items():
        code += [('dup',), ('getproperty', q('h')), e.string(field),
                 e.string(kind), ('setproperty', 14)]
    changes = {label: queue(e, label, code, len(ops) - 1)}
    label = TARGETS[1]
    ops = asm.decode(e.body(label)[5])
    anchors = [i for i, o in enumerate(ops) if o.name == 'callproperty'
               and e.abc.mn_name(o.args[0]) == 'resolveMap1471']
    assert len(anchors) == 1
    at = anchors[0]
    # Both inherited C1 additions are checked; this modifies the actual arrays
    # passed to ANONYMOUS, not an unused string-pool entry.
    assert ops[at + 7].name == 'newarray' and ops[at + 7].args == [5]
    assert e.abc.s(ops[at + 9].args[0]) == 'weapon_rivens'
    assert ops[at + 15].name == 'newarray' and ops[at + 15].args == [1]
    assert e.abc.s(ops[at + 17].args[0]) == 'weapon_rivens'
    append = []
    for field in FIELDS:
        append += [('dup',), e.string(field), ('callpropvoid', q('push'), 1)]
    changes[label] = {
        'fields': queue(e, label, append, at + 11),
        'optional': queue(e, label, append, at + 19),
    }
    assert not e.new_methods and not e.traits
    return {'methods': changes, 'fields': FIELDS, 'optional': list(FIELDS),
            'type': 'pinball.common.data.cooperation.BattleParty',
            'shared_by': ['Mate.party', 'BattleSource.party',
                          'MultiBattleSource.myBattleSource',
                          'MultiBattleSource.otherBattleSources', 'MultiBattleSource.sources'],
            'baseline_method_hashes': {k: sha(e.body(k)[5]) for k in TARGETS}}
