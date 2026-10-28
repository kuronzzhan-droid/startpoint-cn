"""P0b TypePacker schema: only reversible insertions into two existing bodies."""
import hashlib
import asm

FIELD = 'weapon_rivens'
ROW = 'Array<Int>'
SLOT = 'haxe.ds.Option<Array<Int>>'
SLOTS = 'Array<haxe.ds.Option<Array<Int>>>'
PARTY = 'pinball.common.data.cooperation.BattleParty'
TARGETS = ('TypePackerResource2/resolveMap1471', 'TypePackerResource2/resolveMap2201')


def _lock(editor, label):
    body = editor.body(label)
    editor.locks[label] = {'sha': hashlib.sha256(body[5]).hexdigest(), 'header': body[1:5]}
    assert not body[6] and not body[7]
    return body


def add_type_splices(editor):
    """Queue schema changes; caller applies once with its other P0b splices."""
    e, q, dynamic = editor, editor.q, 14
    assert e.abc.multinames[dynamic] == (0x1b, 1)
    typeinfo = q('typepacker.core::TypeInformation')
    gp = lambda name: ('getproperty', q(name))
    call = lambda name, n: ('callproperty', q(name), n)
    map_body = _lock(e, TARGETS[0])
    map_ops = asm.decode(map_body[5])
    assert [(x.name, x.args) for x in map_ops[-2:]] == [('getlocal_1', []), ('returnvalue', [])]
    # The original return map stays on the stack while its new public field is set.
    e.insert(TARGETS[0], len(map_ops) - 1,
             [('dup',), gp('h'), e.string(FIELD), e.string(SLOTS), ('setproperty', dynamic)])

    body = _lock(e, TARGETS[1])
    ops = asm.decode(body[5])
    anchor = [i for i, x in enumerate(ops) if x.name == 'callproperty'
              and e.abc.mn_name(x.args[0]) == 'resolveMap1471']
    assert len(anchor) == 1
    i = anchor[0]
    expected = ['abilitySoulIds', 'characters', 'equipments', 'options', 'unison_characters']
    assert [e.abc.s(x.args[0]) for x in ops[i+2:i+7]] == expected
    assert ops[i+7].name == 'newarray' and ops[i+7].args == [5]
    assert ops[i+12].name == 'newarray' and ops[i+12].args == [1]
    assert e.abc.s(ops[i+11].args[0]) == 'options'
    append = [('dup',), e.string(FIELD), ('callpropvoid', q('push'), 1)]
    e.insert(TARGETS[1], i+8, append)
    e.insert(TARGETS[1], i+13, append)

    # SLOT is already registered by resolveMap2179/2180 in this same method.
    # Only its outer collection needs a type key; no runtime class is created.
    slot_names = [i for i, op in enumerate(ops) if op.name == 'pushstring'
                  and e.abc.s(op.args[0]) == SLOT]
    assert len(slot_names) == 3, 'expected original SLOT registration only'
    assert not any(op.name == 'pushstring' and e.abc.s(op.args[0]) == SLOTS for op in ops)
    code = [('dup',), gp('h'), e.string(SLOTS), ('getlex', typeinfo),
            e.string(SLOT), ('pushbyte', 0), call('COLLECTION', 2), ('setproperty', dynamic)]
    assert [(x.name, x.args) for x in ops[-2:]] == [('getlocal_1', []), ('returnvalue', [])]
    e.insert(TARGETS[1], len(ops) - 1, code)
    return {'field': FIELD, 'type': SLOTS, 'row': '[item_id, weapon_id, key1, L1, ...]',
            'optional': True, 'registered_type_keys': [SLOTS],
            'existing_row_type': ROW, 'existing_slot_type': SLOT,
            'original_field_order': expected, 'new_field_order': expected + [FIELD],
            'original_optional_fields': ['options'], 'new_optional_fields': ['options', FIELD]}
