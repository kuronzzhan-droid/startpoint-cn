"""Inline record normalization shared by login and common-response splices."""
DYNAMIC = 14
MIN_ITEM, MAX_ITEM = 16000001, 16000200


def get_field(e, name):
    return [e.string(name), ('getproperty', DYNAMIC)]


def set_field(e, name, value):
    return [e.string(name), *value, ('setproperty', DYNAMIC)]


def copy_dictionary(e, source, target, first_local, prefix):
    """Copy only registered instance IDs and valid current/pending affix rows.

    Source records are immutable inputs. Every stored record and nested array is
    recreated, so applying later deltas cannot mutate a logged response object.
    """
    ident, row, terms, copied, term, index, pending, pending_copy, current = range(
        first_local, first_local + 9)
    get = lambda n: ('getlocal', n)
    put = lambda n: ('setlocal', n)
    num = lambda n: ('pushbyte', n) if 0 <= n <= 127 else ('pushint', e.pool.integer(n))
    field = lambda name: get_field(e, name)
    lab = lambda name: prefix + '_' + name
    code = [('newobject', 0), put(target), get(source), ('iffalse', lab('done')),
            num(MIN_ITEM), put(ident), ('label', lab('test')), ('avm_label',),
            get(ident), num(MAX_ITEM), ('ifgt', lab('done')),
            get(source), get(ident), ('getproperty', DYNAMIC), put(row),
            get(row), ('iffalse', lab('next'))]
    for name in ('riven_id', 'weapon_id'):
        code += [get(row), *field(name), ('convert_i',), num(0), ('ifle', lab('next'))]

    def affixes(stage):
        begin, done = lab(stage + '_test'), lab(stage + '_done')
        out = [get(terms), ('istype', e.q('Array')), ('iffalse', lab('next')),
               get(terms), ('getproperty', e.q('length')), num(1), ('iflt', lab('next')),
               get(terms), ('getproperty', e.q('length')), num(4), ('ifgt', lab('next')),
               ('newarray', 0), put(copied), num(0), put(index),
               ('label', begin), ('avm_label',), get(index), get(terms),
               ('getproperty', e.q('length')), ('ifge', done), get(terms), get(index),
               ('getproperty', DYNAMIC), put(term), get(term), ('istype', e.q('Array')),
               ('iffalse', lab('next')), get(term), ('getproperty', e.q('length')),
               num(2), ('ifne', lab('next'))]
        for slot, minimum, maximum in ((0, 1, 2147483647), (1, 1, 100)):
            # Equality with int rejects fractional numbers, strings, and overflow.
            out += [get(term), num(slot), ('getproperty', DYNAMIC),
                    get(term), num(slot), ('getproperty', DYNAMIC), ('convert_i',),
                    ('ifstrictne', lab('next')), get(term), num(slot),
                    ('getproperty', DYNAMIC), num(minimum), ('iflt', lab('next'))]
            if slot == 1:
                out += [get(term), num(slot), ('getproperty', DYNAMIC), num(maximum),
                        ('ifgt', lab('next'))]
        out += [get(copied), get(term), num(0), ('getproperty', DYNAMIC),
                get(term), num(1), ('getproperty', DYNAMIC), ('newarray', 2),
                ('callpropvoid', e.q('push'), 1), ('inclocal_i', index),
                ('jump', begin), ('label', done)]
        return out

    code += [get(row), *field('affixes'), put(terms), *affixes('current'),
             get(copied), put(current), get(row), *field('pending'), put(pending),
             ('pushnull',), put(pending_copy), get(pending), ('iffalse', lab('record')),
             get(pending), *field('draw_id'), ('istype', e.q('String')),
             ('iffalse', lab('next')), get(pending), *field('affixes'), put(terms),
             *affixes('pending'), e.string('draw_id'), get(pending), *field('draw_id'),
             e.string('affixes'), get(copied), ('newobject', 2), put(pending_copy),
             ('label', lab('record')), get(target), get(ident)]
    for name in ('riven_id', 'weapon_id', 'roll_count', 'revision', 'next_cost'):
        code += [e.string(name), get(row), *field(name), ('convert_i',)]
    code += [e.string('affixes'), get(current), e.string('pending'), get(pending_copy),
             ('newobject', 7), ('setproperty', DYNAMIC), ('label', lab('next')),
             ('inclocal_i', ident), ('jump', lab('test')), ('label', lab('done'))]
    return code
