"""Inline C1 lookup and snapshot construction; no AVM2 helpers or traits added."""
DYNAMIC = 14
RIVEN_MIN, RIVEN_MAX = 16000001, 16000200
EQUIPMENT_TABLE = 'pinball.master.generated::EquipmentTable'


def number(e, value):
    return ('pushbyte', value) if 0 <= value <= 127 else ('pushint', e.pool.integer(value))


def dynamic_get(e, name):
    return [e.string(name), ('getproperty', DYNAMIC)]


def lookup(e, ident, scratch, record, fail, party=False):
    """Resolve a reserved instance ID to a current local save-data record."""
    gp = lambda name: ('getproperty', e.q(name))
    get = lambda local: ('getlocal', local)
    put = lambda local: ('setlocal', local)
    code = [get(ident), number(e, RIVEN_MIN), ('iflt', fail),
            get(ident), number(e, RIVEN_MAX), ('ifgt', fail)]
    if party:
        code += [('getlocal_0',), gp('player'), ('coerce_a',), put(scratch),
                 get(scratch), ('iffalse', fail)]
    else:
        code += [('getlex', e.q('PinballClientMain')), gp('top'),
                 ('coerce_a',), put(scratch), get(scratch), ('iffalse', fail)]
        for field in ('logic', 'globalLogic'):
            code += [get(scratch), gp(field), ('coerce_a',), put(scratch),
                     get(scratch), ('iffalse', fail)]
        # get_player throws C2000 before login; inspect its backing save first.
        code += [get(scratch), gp('logicStatus'), ('coerce_a',), put(record),
                 get(record), ('iffalse', fail), get(record),
                 ('callproperty', e.q('getPlayerSaveData'), 0), ('iffalse', fail),
                 get(scratch), ('callproperty', e.q('get_player'), 0),
                 ('coerce_a',), put(scratch), get(scratch), ('iffalse', fail)]
    code += [get(scratch), gp('saveData'), ('coerce_a',), put(scratch),
             get(scratch), ('iffalse', fail), get(scratch)]
    code += dynamic_get(e, 'weapon_rivens')
    code += [('coerce_a',), put(scratch), get(scratch), ('iffalse', fail),
             get(scratch), get(ident), ('getproperty', DYNAMIC), ('coerce_a',),
             put(record), get(record), ('iffalse', fail)]
    return code


def flatten(e, ident, record, row, affixes, index, term, fail, prefix):
    """Freeze scalars into a new [item_id,weapon_id,key,L,...] battle row."""
    q = e.q
    get = lambda local: ('getlocal', local)
    put = lambda local: ('setlocal', local)
    num = lambda value: number(e, value)
    dg = lambda name: dynamic_get(e, name)
    gp = lambda name: ('getproperty', q(name))
    test, done = prefix + '_term_test', prefix + '_term_done'
    code = [get(record)] + dg('affixes')
    code += [('coerce_a',), put(affixes), get(affixes), ('iffalse', fail),
             get(affixes), gp('length'), num(1), ('iflt', fail),
             get(affixes), gp('length'), num(4), ('ifgt', fail),
             get(ident), get(record)] + dg('weapon_id')
    code += [('convert_i',), ('newarray', 2), put(row), num(0), put(index),
             ('label', test), ('avm_label',), get(index), get(affixes), gp('length'),
             ('ifge', done), get(affixes), get(index), ('getproperty', DYNAMIC),
             ('coerce_a',), put(term), get(term), ('iffalse', fail),
             get(term), gp('length'), num(2), ('ifne', fail),
             get(term), num(0), ('getproperty', DYNAMIC), num(1), ('iflt', fail),
             get(term), num(1), ('getproperty', DYNAMIC), num(1), ('iflt', fail),
             get(term), num(1), ('getproperty', DYNAMIC), num(100), ('ifgt', fail),
             get(row), get(term), num(0), ('getproperty', DYNAMIC), ('convert_i',),
             get(term), num(1), ('getproperty', DYNAMIC), ('convert_i',),
             ('callpropvoid', q('http://adobe.com/AS3/2006/builtin::push'), 2),
             ('inclocal_i', index), ('jump', test), ('label', done)]
    return code


def equipment_name(e, item_local, record):
    """Leave the bound equipment master-table name on the operand stack."""
    q = e.q
    return [('getlocal', item_local), ('getproperty', q('logicAssets')),
            ('getlex', q(EQUIPMENT_TABLE)), ('callproperty', q('getMasterTable'), 1),
            ('callproperty', q('get_data'), 0), ('getlocal', record),
            *dynamic_get(e, 'weapon_id'), ('convert_i',),
            ('callproperty', q('get'), 1), ('getproperty', q('name'))]
