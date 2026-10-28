"""Optional CommonResponse party deltas reuse the existing PartyInfo schema."""
import asm
from c2_common import queue, DYNAMIC

FIELD = 'party_info_list'
PARTY_LIST = 'Array<pinball.remote.party.PartyInfo>'


def queue_party_types(e):
    label = 'TypePackerResource2/resolveMap848'
    ops = asm.decode(e.body(label)[5])
    assert ops[-1].name == 'returnvalue'
    queue(e, label, [('dup',), ('getproperty', e.q('h')), e.string(FIELD),
                     e.string(PARTY_LIST), ('setproperty', DYNAMIC)], at=len(ops)-1)
    label = 'TypePackerResource2/resolveMap2201'
    ops = asm.decode(e.body(label)[5])
    anchors = [i for i, op in enumerate(ops) if op.name == 'callproperty'
               and e.abc.mn_name(op.args[0]) == 'resolveMap848']
    assert len(anchors) == 1
    start = anchors[0]
    end = next(i for i in range(start+1, start+80) if ops[i].name == 'callproperty'
               and e.abc.mn_name(ops[i].args[0]) == 'ANONYMOUS')
    arrays = [i for i in range(start+1, end) if ops[i].name == 'newarray']
    assert len(arrays) == 2 and [ops[i].args for i in arrays] == [[14], [2]]
    append = [('dup',), e.string(FIELD), ('callpropvoid', e.q('push'), 1)]
    for at in arrays:
        queue(e, label, append, at=at+1)
    # PartyInfo originally represents normal parties only and has no category.
    # Preserve the server's category through the command recorder/replayer while
    # old PartyInfo objects remain valid because this additive field is optional.
    party_map = 'TypePackerResource2/resolveMap632'
    map_ops = asm.decode(e.body(party_map)[5])
    assert map_ops[-1].name == 'returnvalue'
    queue(e, party_map, [('dup',), ('getproperty', e.q('h')), e.string('party_category'),
                         e.string('Int'), ('setproperty', DYNAMIC)], at=len(map_ops)-1)
    matches = [i for i, op in enumerate(ops) if op.name == 'callproperty'
               and e.abc.mn_name(op.args[0]) == 'resolveMap632']
    assert len(matches) == 1
    array = next(i for i in range(matches[0]+1,matches[0]+30) if ops[i].name == 'newarray')
    assert ops[array].args == [8]
    assert [op.name for op in ops[array+1:array+7]] == [
        'pushnull','coerce','pushfalse','pushnull','coerce','callproperty']
    queue(e, label, [('dup',), e.string('party_category'), ('callpropvoid', e.q('push'), 1)], at=array+1)
    queue(e, label, [('pop',), e.string('party_category'), ('newarray', 1)], at=array+5)
    return {'field': FIELD, 'type': PARTY_LIST, 'optional': True,
            'party_info_optional_field': 'party_category:Int',
            'new_runtime_types': [], 'registry_method': label}
