"""Inline checks for all three serialized MultiBattleSource views."""
from c1_lookup import number
from c2_common import DYNAMIC, get


def views(e, values, first, fail, tag):
    """Return equally ordered arrays, without assuming restored object aliasing."""
    source, roster, mine, other, split, ordered, i, j, one, found, config = range(first, first + 11)
    g = lambda n: ('getlocal', n)
    s = lambda n: ('setlocal', n)
    n = lambda x: number(e, x)
    gp = lambda x: ('getproperty', e.q(x))
    push = ('callpropvoid', e.q('http://adobe.com/AS3/2006/builtin::push'), 1)
    label = lambda x: ('label', tag + x)
    jump = lambda op, x: (op, tag + x)
    code = [g(values), ('iffalse', fail), g(values), gp('playId'), ('typeof',),
            e.string('string'), ('ifne', fail), g(values), gp('playId'), gp('length'),
            n(0), ('ifle', fail), g(values), gp('source'), s(source),
            g(source), ('iffalse', fail), g(source), gp('sources'), s(roster),
            g(roster), ('istype', e.q('Array')), ('iffalse', fail),
            g(source), gp('myBattleSource'), s(mine), g(mine), ('iffalse', fail),
            g(source), gp('otherBattleSources'), s(other),
            g(other), ('istype', e.q('Array')), ('iffalse', fail),
            g(roster), gp('length'), g(other), gp('length'), n(1), ('add_i',), ('ifne', fail),
            g(mine), ('newarray', 1), g(other),
            ('callproperty', e.q('http://adobe.com/AS3/2006/builtin::concat'), 1), s(split),
            ('newarray', 0), s(ordered), n(0), s(i), label('_outer'), ('avm_label',),
            g(i), g(roster), gp('length'), jump('ifge', '_matched'),
            g(roster), g(i), ('getproperty', DYNAMIC), s(one), g(one), ('iffalse', fail),
            g(one), gp('id'), ('typeof',), e.string('string'), ('ifne', fail),
            g(one), gp('id'), gp('length'), n(0), ('ifle', fail),
            ('pushnull',), s(found), n(0), s(j), label('_inner'), ('avm_label',),
            g(j), g(split), gp('length'), jump('ifge', '_inner_done'),
            g(split), g(j), ('getproperty', DYNAMIC), ('iffalse', fail),
            g(one), gp('id'), g(split), g(j), ('getproperty', DYNAMIC), gp('id'), jump('ifne', '_next'),
            g(found), ('iftrue', fail), g(split), g(j), ('getproperty', DYNAMIC), s(found),
            label('_next'), ('inclocal_i', j), jump('jump', '_inner'),
            label('_inner_done'), g(found), ('iffalse', fail), g(ordered), g(found), push,
            ('inclocal_i', i), jump('jump', '_outer'), label('_matched'),
            g(values), gp('config'), s(config), g(config), ('iffalse', fail),
            g(config), gp('index'), n(0), ('ifne', fail),
            g(config), gp('params'), n(0), ('getproperty', DYNAMIC), s(config),
            g(config), ('iffalse', fail), g(config), gp('connectionId'), g(mine), gp('id'), ('ifne', fail),
            g(config), gp('roomNumber'), ('typeof',), e.string('string'), ('ifne', fail),
            g(config), gp('roomNumber'), gp('length'), n(0), ('ifle', fail)]
    return code, {'roster': roster, 'ordered': ordered, 'mine': mine, 'next_local': first + 11}


def relevant(e, values, first, active, done, tag):
    """Preserve legacy/raid headers, but inspect every view for hidden P2 data."""
    source, arrays, outer, arr, inner, one, party, souls, slot, ident = range(first, first + 10)
    g = lambda n: ('getlocal', n)
    s = lambda n: ('setlocal', n)
    n = lambda x: number(e, x)
    gp = lambda x: ('getproperty', e.q(x))
    L = lambda x: tag + x
    # Malformed native structures retain native failure handling unless they contain P2.
    code = [g(values), ('iffalse', done), g(values), gp('source'), s(source),
            g(source), ('iffalse', done), g(source), gp('sources'),
            g(source), gp('myBattleSource'), ('newarray', 1),
            g(source), gp('otherBattleSources'), ('newarray', 3), s(arrays),
            n(0), s(outer), ('label', L('_arrays')), ('avm_label',),
            g(outer), n(3), ('ifge', done), g(arrays), g(outer), ('getproperty', DYNAMIC), s(arr),
            g(arr), ('istype', e.q('Array')), ('iffalse', L('_outer_next')),
            n(0), s(inner), ('label', L('_members')), ('avm_label',),
            g(inner), g(arr), gp('length'), ('ifge', L('_outer_next')),
            g(arr), g(inner), ('getproperty', DYNAMIC), s(one), g(one), ('iffalse', L('_member_next')),
            g(one), gp('party'), s(party), g(party), ('iffalse', L('_member_next'))]
    for field in ('weapon_riven_scope', 'weapon_riven_snapshot_id', 'weapon_riven_mode',
                  'weapon_riven_catalog', 'weapon_riven_reason'):
        code += [g(party), *get(e, field), ('pushnull',), ('ifne', active)]
    code += [g(party), *get(e, 'weapon_rivens'), s(souls), g(souls), ('pushnull',),
             ('ifeq', L('_row_done')), g(souls), ('istype', e.q('Array')), ('iffalse', active),
             n(0), s(slot), ('label', L('_rows')), ('avm_label',),
             g(slot), g(souls), gp('length'), ('ifge', L('_row_done')),
             g(souls), g(slot), ('getproperty', DYNAMIC), s(ident),
             g(ident), ('iffalse', active), g(ident), gp('index'), n(1), ('ifne', active),
             ('inclocal_i', slot), ('jump', L('_rows')), ('label', L('_row_done')),
             g(party), gp('abilitySoulIds'), s(souls), g(souls), ('istype', e.q('Array')),
             ('iffalse', L('_member_next')), n(0), s(slot), ('label', L('_souls')), ('avm_label',),
             g(slot), g(souls), gp('length'), ('ifge', L('_member_next')),
             g(souls), g(slot), ('getproperty', DYNAMIC), s(ident), g(ident), ('iffalse', L('_slot_next')),
             g(ident), gp('index'), n(0), ('ifne', L('_slot_next')),
             g(ident), gp('params'), n(0), ('getproperty', DYNAMIC), s(ident),
             g(ident), n(16000001), ('iflt', L('_slot_next')),
             g(ident), n(16000999), ('ifgt', L('_slot_next')),
             g(ident), e.string('16000900'), ('convert_i',), ('ifne', active),
             ('label', L('_slot_next')), ('inclocal_i', slot), ('jump', L('_souls')),
             ('label', L('_member_next')), ('inclocal_i', inner), ('jump', L('_members')),
             ('label', L('_outer_next')), ('inclocal_i', outer), ('jump', L('_arrays'))]
    return code, first + 10
