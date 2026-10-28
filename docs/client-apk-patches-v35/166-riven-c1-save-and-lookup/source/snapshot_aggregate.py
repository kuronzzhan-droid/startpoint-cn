"""Existing donor construction/filter/merge, with a flat snapshot row as input."""
ABILITY = 'pinball.common.data.ability::AbilitySoulAbilityLogic'
POWER = 'pinball.common.data.ability::AbilityPowerValue'
SCALE = 'pinball.common.data.ability::AbilityPowerValueCalculateMethod'
OPTION = 'haxe.ds::Option'
INTMAP = 'haxe.ds::IntMap'


def aggregate(e, ident, row, first_local):
    q = e.q
    merged, result, entry_i, donor, active, active_i, inner, slot = range(first_local, first_local + 8)
    get = lambda n: ('getlocal', n)
    put = lambda n: ('setlocal', n)
    num = lambda n: ('pushbyte', n)
    gp = lambda n: ('getproperty', q(n))
    sp = lambda n: ('setproperty', q(n))
    call = lambda n, count: ('callproperty', q(n), count)
    return [
        ('pushnull',), ('coerce', q(ABILITY)), put(result),
        ('findpropstrict', q(INTMAP)), ('constructprop', q(INTMAP), 0), put(merged),
        num(1), put(slot), num(2), put(entry_i),
        ('label', 'donor_test'), ('avm_label',), get(entry_i), get(row), gp('length'),
        ('ifge', 'finish'), ('findpropstrict', q(ABILITY)), num(31),
        get(row), get(entry_i), ('getproperty', 14), ('convert_i',),
        ('getlex', q(SCALE)), get(row), get(entry_i), num(1), ('add_i',),
        ('getproperty', 14), ('convert_i',), num(1), num(100),
        call('MinToMaxLevelScale', 3), ('pushfalse',), ('getlocal_0',), gp('logicAssets'),
        ('constructprop', q(ABILITY), 5), ('coerce', q(ABILITY)), put(donor),
        get(donor), call('getTriggers', 0), ('coerce', q('Array')), put(active),
        get(result), ('iftrue', 'have_result'), get(donor), put(result),
        ('label', 'have_result'), num(0), put(active_i),
        ('label', 'trigger_test'), ('avm_label',), get(active_i), get(active), gp('length'),
        ('ifge', 'next_donor'), ('findpropstrict', q(INTMAP)),
        ('constructprop', q(INTMAP), 0), put(inner),
        get(inner), gp('h'), num(1), get(active), get(active_i), ('getproperty', 14),
        ('setproperty', 14), get(merged), gp('h'), get(slot), get(inner), ('setproperty', 14),
        ('inclocal_i', slot), ('inclocal_i', active_i), ('jump', 'trigger_test'),
        ('label', 'next_donor'), get(entry_i), num(2), ('add_i',), put(entry_i),
        ('jump', 'donor_test'), ('label', 'finish'),
        get(result), get(merged), sp('triggers'), get(result), get(ident), sp('id'),
        get(result), num(31), sp('number'), get(result), ('pushfalse',), sp('isEquipment'),
        get(result), ('pushnull',), sp('_elements'),
        get(result), ('findpropstrict', q(POWER)), ('getlex', q(SCALE)), gp('MinimumLevel'),
        ('constructprop', q(POWER), 1), sp('power'),
        ('getlex', q(OPTION)), get(result), call('Some', 1), ('returnvalue',),
    ]
