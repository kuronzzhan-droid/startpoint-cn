"""Parse server PartyInfo deltas into the client's existing Option convention."""
from c1_lookup import number
from c2_common import DYNAMIC, get, set_


def parse_parties(e, first):
    rows, index, row, parsed, array, output, slot, value, results = range(first, first+9)
    g = lambda v: ('getlocal', v)
    p = lambda v: ('setlocal', v)
    n = lambda v: number(e, v)
    q = e.q
    done, again, skip = 'c4_party_parse_done', 'c4_party_parse_loop', 'c4_party_parse_skip'
    code = [('getlocal_2',), ('getproperty', q('rawData')), *get(e, 'data'),
            *get(e, 'party_info_list'), p(rows), g(rows), ('istype', q('Array')),
            ('iffalse', done), ('newarray', 0), p(results), n(0), p(index),
            ('label', again), ('avm_label',), g(index), g(rows), ('getproperty', q('length')),
            ('ifge', 'c4_party_parse_store'), g(rows), g(index), ('getproperty', DYNAMIC), p(row),
            g(row), ('iffalse', skip)]
    for field in ('party_id', 'party_category'):
        code += [g(row), *get(e, field), ('istype', q('Number')), ('iffalse', skip),
                 g(row), *get(e, field), ('convert_i',), p(value), g(value), n(1),
                 ('iflt', skip), g(value), g(row), *get(e, field), ('ifne', skip)]
    code += [g(row), *get(e, 'party_name'), ('istype', q('String')), ('iffalse', skip),
             g(row), *get(e, 'options'), ('iffalse', skip), ('newobject', 0), p(parsed)]
    for field in ('party_id', 'party_category', 'party_name', 'party_edited'):
        code += [g(parsed), *set_(e, field, [g(row), *get(e, field)])]
    code += [g(parsed), *set_(e, 'options', [e.string('allow_other_players_to_heal_me'),
             g(row), *get(e, 'options'), *get(e, 'allow_other_players_to_heal_me'),
             ('convert_b',), ('newobject', 1)])]
    for field in ('character_ids', 'unison_character_ids', 'equipment_ids', 'ability_soul_ids'):
        loop, empty, append, end = [f'c4_party_{field}_{name}' for name in ('loop','none','append','end')]
        code += [g(row), *get(e, field), p(array), g(array), ('istype', q('Array')),
                 ('iffalse', skip), g(array), ('getproperty', q('length')), n(3), ('ifne', skip),
                 ('newarray', 0), p(output), n(0), p(slot), ('label', loop), ('avm_label',),
                 g(slot), n(3), ('ifge', end), g(array), g(slot), ('getproperty', DYNAMIC), p(value),
                 g(value), ('pushnull',), ('ifeq', empty), g(value), ('istype', q('Number')),
                 ('iffalse', skip), g(value), ('convert_i',), g(value), ('ifne', skip),
                 g(value), n(1), ('iflt', skip), g(output), ('getlex', q('haxe.ds::Option')),
                 g(value), ('convert_i',), ('callproperty', q('Some'), 1), ('jump', append),
                 ('label', empty), g(output), ('getlex', q('haxe.ds::Option')), ('getproperty', q('None')),
                 ('label', append), ('callpropvoid', q('http://adobe.com/AS3/2006/builtin::push'), 1),
                 ('inclocal_i', slot), ('jump', loop), ('label', end),
                 g(parsed), *set_(e, field, [g(output)])]
    code += [g(results), g(parsed), ('callpropvoid', q('http://adobe.com/AS3/2006/builtin::push'), 1),
             ('label', skip), ('inclocal_i', index), ('jump', again),
             ('label', 'c4_party_parse_store'), ('getlocal', 28), *set_(e, 'party_info_list', [g(results)]),
             ('label', done)]
    return code
