"""Register C1 save/response schemas by splicing existing TypePacker methods."""
import hashlib
import asm

DYNAMIC = 14
AFFIXES = 'c1.WeaponRivenAffixes'
PENDING = 'c1.WeaponRivenPending'
RECORD = 'c1.WeaponRivenRecord'
RECORDS = 'c1.WeaponRivenList'
RECORD_FIELDS = {'riven_id': 'Int', 'weapon_id': 'Int', 'affixes': AFFIXES,
                 'roll_count': 'Int', 'revision': 'Int', 'next_cost': 'Int', 'pending': PENDING}
PENDING_FIELDS = {'draw_id': 'String', 'affixes': AFFIXES}
SCHEMAS = {
    'TypePackerResource2/resolveMap1254': {'weapon_rivens': RECORDS},
    'TypePackerResource2/resolveMap848': {
        'weapon_riven_list': RECORDS, 'weapon_riven_deleted': 'Array<Int>'},
}
REGISTER = 'TypePackerResource2/resolveMap2201'


def _lock(e, label):
    body = e.body(label)
    e.locks[label] = {'sha': hashlib.sha256(body[5]).hexdigest(), 'header': body[1:5]}
    assert not body[6] and not body[7]
    return body, asm.decode(body[5])


def queue_type_splices(e):
    gp = lambda name: ('getproperty', e.q(name))
    call = lambda name, n: ('callproperty', e.q(name), n)
    typeinfo = e.q('typepacker.core::TypeInformation')
    stringmap = e.q('haxe.ds::StringMap')
    for label, fields in SCHEMAS.items():
        body, ops = _lock(e, label)
        assert ops[-2].name == 'getlocal_1' and ops[-1].name == 'returnvalue'
        code = []
        for name, kind in fields.items():
            code += [('dup',), gp('h'), e.string(name), e.string(kind), ('setproperty', DYNAMIC)]
        e.insert(label, len(ops) - 1, code)

    body, ops = _lock(e, REGISTER)
    for label, fields in SCHEMAS.items():
        method = label.split('/')[1]
        anchors = [i for i, x in enumerate(ops) if x.name == 'callproperty'
                   and e.abc.mn_name(x.args[0]) == method]
        assert len(anchors) == 1
        i = anchors[0]
        array = next(j for j in range(i + 1, i + 60) if ops[j].name == 'newarray')
        assert [x.name for x in ops[array + 1:array + 7]] == [
            'pushnull', 'coerce', 'pushfalse', 'pushnull', 'coerce', 'callproperty']
        assert e.abc.mn_name(ops[array + 6].args[0]) == 'ANONYMOUS'
        append = []
        for name in fields:
            append += [('dup',), e.string(name), ('callpropvoid', e.q('push'), 1)]
        e.insert(REGISTER, array + 1, append)
        # Mark extension fields optional so pre-C1 logs remain concretizable.
        optional = [('pop',)] + [e.string(name) for name in fields] + [('newarray', len(fields))]
        e.insert(REGISTER, array + 5, optional)

    def registration(key, value_code):
        # The original return map is already on the stack; keep it there.
        return [('dup',), gp('h'), e.string(key), *value_code, ('setproperty', DYNAMIC)]

    def anonymous(fields):
        code = [('getlex', typeinfo), ('findpropstrict', stringmap),
                ('constructprop', stringmap, 0)]
        for name, kind in fields.items():
            code += [('dup',), gp('h'), e.string(name), e.string(kind), ('setproperty', DYNAMIC)]
        code += [e.string(name) for name in fields]
        code += [('newarray', len(fields)), ('pushnull',), ('pushfalse',), ('pushnull',),
                 call('ANONYMOUS', 5)]
        return code

    code = registration(AFFIXES, [('getlex', typeinfo), e.string('Array<Int>'),
                                 ('pushbyte', 0), call('COLLECTION', 2)])
    code += registration(PENDING, anonymous(PENDING_FIELDS))
    code += registration(RECORD, anonymous(RECORD_FIELDS))
    code += registration(RECORDS, [('getlex', typeinfo), e.string(RECORD), call('DYNAMIC_ACCESS', 1)])
    assert ops[-1].name == 'returnvalue'
    e.insert(REGISTER, len(ops) - 1, code)
    return {'types': {AFFIXES: 'Array<Array<Int>>', PENDING: PENDING_FIELDS,
                      RECORD: RECORD_FIELDS, RECORDS: 'DYNAMIC_ACCESS<' + RECORD + '>'},
            'fields': SCHEMAS, 'optional_extension_fields': True,
            'loaded_data': 'Unchanged: existing player field recursively uses PlayerSaveData schema.',
            'no_new_methods_or_traits': True}
