"""P0a inline AVM2 only: literal lookup, weapon gate, independently scaled donors."""

ABILITY = 'pinball.common.data.ability::AbilitySoulAbilityLogic'
POWER = 'pinball.common.data.ability::AbilityPowerValue'
SCALE = 'pinball.common.data.ability::AbilityPowerValueCalculateMethod'
OPTION = 'haxe.ds::Option'
INTMAP = 'haxe.ds::IntMap'


def make_prefix(e, entries, battle, first_local):
    """Return a splice block; all exits return or fall into original bytes."""
    q = e.q
    dynamic = 14  # Existing public runtime-name operand used by Haxe IntMap/Array.
    assert e.abc.multinames[dynamic] == (0x1b, 1)
    ident, row, aggregate, merged, entry_i, donor, active, active_i, inner, slot = range(
        first_local, first_local + 10)
    get = lambda n: ('getlocal', n)
    put = lambda n: ('setlocal', n)
    num = lambda n: ('pushbyte', n) if 0 <= n <= 127 else ('pushint', e.pool.integer(n))
    gp = lambda name: ('getproperty', q(name))
    sp = lambda name: ('setproperty', q(name))
    call = lambda name, n: ('callproperty', q(name), n)
    code = []
    if battle:
        code += [('getlocal_0',), gp('abilitySoul'), gp('index'), num(0),
                 ('ifne', 'original'), ('getlocal_0',), gp('abilitySoul'),
                 gp('params'), num(0), ('getproperty', dynamic),
                 call('get_abilitySoulId', 0), ('convert_i',), put(ident)]
    else:
        code += [('getlocal_0',), call('get_abilitySoulId', 0),
                 ('convert_i',), put(ident)]
    # Mapping exists solely as method-body literals; no class/trait/helper is added.
    for entry in entries:
        code += [e.string(str(entry['carrier_id'])), num(entry['weapon_id'])]
        for term in entry['terms']:
            code += [num(term['key']), num(term['level'])]
        code += [('newarray', 1 + 2 * len(entry['terms']))]
    code += [('newobject', len(entries)), get(ident), ('getproperty', dynamic),
             ('coerce_a',), put(row), get(row), ('iffalse', 'original')]
    if battle:
        code += [('getlocal_0',), gp('isUnison'), ('iftrue', 'inactive'),
                 ('getlocal_0',), gp('equipment'), gp('index'), num(0),
                 ('ifne', 'inactive'), ('getlocal_0',), gp('equipment'),
                 gp('params'), num(0), ('getproperty', dynamic), gp('id'),
                 get(row), num(0), ('getproperty', dynamic), ('ifne', 'inactive')]
    code += [('pushnull',), ('coerce', q(ABILITY)), put(aggregate),
             ('findpropstrict', q(INTMAP)), ('constructprop', q(INTMAP), 0),
             put(merged), num(1), put(slot), num(1), put(entry_i),
             ('label', 'donor_test'), ('avm_label',), get(entry_i), get(row), gp('length'),
             ('ifge', 'finish'), ('findpropstrict', q(ABILITY)), num(31),
             get(row), get(entry_i), ('getproperty', dynamic), ('convert_i',),
             ('getlex', q(SCALE)), get(row), get(entry_i), num(1), ('add_i',),
             ('getproperty', dynamic), ('convert_i',), num(1), num(100),
             call('MinToMaxLevelScale', 3), ('pushfalse',),
             ('getlocal_0',), gp('logicAssets'), ('constructprop', q(ABILITY), 5),
             ('coerce', q(ABILITY)), put(donor),
             get(donor), call('getTriggers', 0), ('coerce', q('Array')), put(active),
             get(aggregate), ('iftrue', 'have_aggregate'), get(donor), put(aggregate),
             ('label', 'have_aggregate'), num(0), put(active_i),
             ('label', 'trigger_test'), ('avm_label',), get(active_i), get(active), gp('length'),
             ('ifge', 'next_donor'),
             ('findpropstrict', q(INTMAP)), ('constructprop', q(INTMAP), 0), put(inner),
             get(inner), gp('h'), num(1), get(active), get(active_i),
             ('getproperty', dynamic), ('setproperty', dynamic),
             get(merged), gp('h'), get(slot), get(inner), ('setproperty', dynamic),
             ('inclocal_i', slot), ('inclocal_i', active_i), ('jump', 'trigger_test'),
             ('label', 'next_donor'), get(entry_i), num(2), ('add_i',), put(entry_i),
             ('jump', 'donor_test'), ('label', 'finish'),
             get(aggregate), get(merged), sp('triggers'),
             get(aggregate), get(ident), sp('id'),
             get(aggregate), num(31), sp('number'),
             get(aggregate), ('pushfalse',), sp('isEquipment'),
             get(aggregate), ('pushnull',), sp('_elements'),
             get(aggregate), ('findpropstrict', q(POWER)),
             ('getlex', q(SCALE)), gp('MinimumLevel'),
             ('constructprop', q(POWER), 1), sp('power')]
    if battle:
        code += [('getlex', q(OPTION)), get(aggregate), call('Some', 1), ('returnvalue',),
                 ('label', 'inactive'), ('getlex', q(OPTION)), gp('None'), ('returnvalue',)]
    else:
        code += [get(aggregate), ('returnvalue',)]
    code += [('label', 'original')]
    return code
