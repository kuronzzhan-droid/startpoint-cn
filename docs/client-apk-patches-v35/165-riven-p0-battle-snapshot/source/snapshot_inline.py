"""Producer-only literals and consumer-only per-battle snapshot access."""
from snapshot_aggregate import aggregate, OPTION


def producer(e, entries, first_local):
    q = e.q
    result, slots, table, index, soul, row = range(first_local, first_local + 6)
    get = lambda n: ('getlocal', n)
    put = lambda n: ('setlocal', n)
    num = lambda n: ('pushbyte', n) if n <= 127 else ('pushint', e.pool.integer(n))
    gp = lambda n: ('getproperty', q(n))
    code = [put(result), ('newarray', 0), put(slots)]
    for entry in entries:
        code += [e.string(str(entry['carrier_id'])), num(entry['carrier_id']), num(entry['weapon_id'])]
        for term in entry['terms']:
            code += [num(term['key']), num(term['level'])]
        code += [('newarray', 2 + 2 * len(entry['terms']))]
    code += [('newobject', len(entries)), put(table), num(0), put(index),
             ('label', 'slot_test'), ('avm_label',), get(index), num(3), ('ifge', 'done'),
             get(result), gp('abilitySoulIds'), get(index), ('getproperty', 14), put(soul),
             get(soul), gp('index'), num(0), ('ifne', 'none'),
             get(table), get(soul), gp('params'), num(0), ('getproperty', 14),
             ('getproperty', 14), ('coerce_a',), put(row), get(row), ('iffalse', 'none'),
             get(slots), get(index), ('getlex', q(OPTION)), get(row), ('newarray', 0),
             ('callproperty', q('http://adobe.com/AS3/2006/builtin::concat'), 1),
             ('callproperty', q('Some'), 1), ('setproperty', 14), ('jump', 'next'),
             ('label', 'none'), get(slots), get(index), ('getlex', q(OPTION)), gp('None'),
             ('setproperty', 14), ('label', 'next'), ('inclocal_i', index), ('jump', 'slot_test'),
             ('label', 'done'), get(result), e.string('weapon_rivens'), get(slots),
             ('setproperty', 14), get(result)]
    return code


def consumer(e, first_local):
    q = e.q
    ident, row, slots, index = range(first_local, first_local + 4)
    get = lambda n: ('getlocal', n)
    put = lambda n: ('setlocal', n)
    num = lambda n: ('pushbyte', n)
    gp = lambda n: ('getproperty', q(n))
    code = [('getlocal_0',), gp('abilitySoul'), gp('index'), num(0), ('ifne', 'original'),
            ('getlocal_0',), gp('abilitySoul'), gp('params'), num(0), ('getproperty', 14),
            ('callproperty', q('get_abilitySoulId'), 0), ('convert_i',), put(ident),
            ('getlocal_0',), gp('party'), ('iffalse', 'original'),
            ('getlocal_0',), gp('party'), gp('values'), ('iffalse', 'original'),
            ('getlocal_0',), gp('party'), gp('values'), e.string('weapon_rivens'),
            ('getproperty', 14), ('coerce_a',), put(slots), get(slots), ('iffalse', 'original'),
            ('getlocal_0',), gp('index'), ('convert_i',), put(index),
            get(index), num(0), ('iflt', 'original'), get(index), get(slots), gp('length'),
            ('ifge', 'original'), get(slots), get(index), ('getproperty', 14), put(row),
            get(row), ('iffalse', 'original'), get(row), gp('index'), num(0), ('ifne', 'original'),
            get(row), gp('params'), num(0), ('getproperty', 14), put(row),
            get(row), ('iffalse', 'original'), get(row), gp('length'), num(4), ('iflt', 'original'),
            get(row), gp('length'), num(2), ('modulo',), num(0), ('ifne', 'original'),
            get(row), num(0), ('getproperty', 14), get(ident), ('ifne', 'original'),
            ('getlocal_0',), gp('isUnison'), ('iftrue', 'inactive'),
            ('getlocal_0',), gp('equipment'), gp('index'), num(0), ('ifne', 'inactive'),
            ('getlocal_0',), gp('equipment'), gp('params'), num(0), ('getproperty', 14), gp('id'),
            get(row), num(1), ('getproperty', 14), ('ifne', 'inactive')]
    code += aggregate(e, ident, row, first_local + 4)
    code += [('label', 'inactive'), ('getlex', q(OPTION)), gp('None'), ('returnvalue',),
             ('label', 'original')]
    return code
