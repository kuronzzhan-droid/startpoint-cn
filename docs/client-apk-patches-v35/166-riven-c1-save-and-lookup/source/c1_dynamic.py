"""Replace P0 literal branches with C1 save-data lookup and local UI splices."""
import copy

import asm
import bodies
from bootstrap import P13, P13_SHA, require_hash, sha
from c1_lookup import DYNAMIC, flatten, lookup, number
from c1_ui import detail_message, name_prefix
from snapshot_aggregate import OPTION, aggregate
from swfabc import SwfAbc

RESTORED = ('GeneralAbilitySoulLogic/getAbility', 'PartyLogic/getBattleParty')
TARGETS = (*RESTORED, 'ItemLogic/get_name', 'AbilitySoulDetailDialog/initialize')


def ability_prefix(e, first_local):
    ident, scratch, record, row, affixes, index, term = range(first_local, first_local + 7)
    code = [('getlocal_0',), ('callproperty', e.q('get_abilitySoulId'), 0),
            ('convert_i',), ('setlocal', ident)]
    code += lookup(e, ident, scratch, record, 'ability_original')
    code += flatten(e, ident, record, row, affixes, index, term,
                    'ability_original', 'ability')
    construction = aggregate(e, ident, row, first_local + 7)
    # The battle consumer returns Option; local item detail returns the ability itself.
    assert construction[-4] == ('getlex', e.q(OPTION))
    assert construction[-2] == ('callproperty', e.q('Some'), 1)
    construction[-4:] = [construction[-3], ('returnvalue',)]
    return code + construction + [('label', 'ability_original')]


def producer_suffix(e, first_local):
    result, slots, slot_i, soul, ident, scratch, record, row, affixes, term_i, term = range(
        first_local, first_local + 11)
    get = lambda local: ('getlocal', local)
    put = lambda local: ('setlocal', local)
    gp = lambda name: ('getproperty', e.q(name))
    num = lambda value: number(e, value)
    code = [put(result), ('newarray', 0), put(slots), num(0), put(slot_i),
            ('label', 'producer_slot_test'), ('avm_label',), get(slot_i), num(3),
            ('ifge', 'producer_done'), get(result), gp('abilitySoulIds'), get(slot_i),
            ('getproperty', DYNAMIC), ('coerce_a',), put(soul),
            get(soul), ('iffalse', 'producer_none'),
            get(soul), gp('index'), num(0), ('ifne', 'producer_none'),
            get(soul), gp('params'), num(0), ('getproperty', DYNAMIC),
            ('convert_i',), put(ident)]
    code += lookup(e, ident, scratch, record, 'producer_none', party=True)
    code += flatten(e, ident, record, row, affixes, term_i, term,
                    'producer_none', 'producer')
    code += [get(slots), get(slot_i), ('getlex', e.q(OPTION)), get(row),
             ('callproperty', e.q('Some'), 1), ('setproperty', DYNAMIC),
             ('jump', 'producer_next'), ('label', 'producer_none'),
             get(slots), get(slot_i), ('getlex', e.q(OPTION)), gp('None'),
             ('setproperty', DYNAMIC), ('label', 'producer_next'),
             ('inclocal_i', slot_i), ('jump', 'producer_slot_test'),
             ('label', 'producer_done'), get(result), e.string('weapon_rivens'),
             get(slots), ('setproperty', DYNAMIC), get(result)]
    return code


def queue_dynamic_splices(editor):
    """Restore two P0 bodies, queue four insertions, and leave apply to the caller."""
    require_hash(P13, P13_SHA)
    baseline = SwfAbc(P13)
    restored, queued = {}, {}
    assert editor.abc.multinames[DYNAMIC] == (0x1b, 1)
    for label in TARGETS:
        body = editor.body(label)
        editor.locks[label] = {'sha': sha(body[5]), 'header': list(body[1:5])}
    for label in RESTORED:
        current = copy.deepcopy(editor.body(label))
        donor = baseline.abc.bodies[bodies.resolve(baseline.abc, label)]
        assert current[0] == donor[0] and current[6:] == donor[6:]
        editor.replace(label, donor[5], copy.deepcopy(donor[6]), list(donor[1:5]))
        restored[label] = {'p0c_sha256': sha(current[5]), 'p13_sha256': sha(donor[5]),
                           'p0c_header': current[1:5], 'p13_header': donor[1:5],
                           'restored_code_equals_p13': editor.body(label)[5] == donor[5]}
        editor.locks[label] = {'sha': sha(donor[5]), 'header': list(donor[1:5])}
    builders = {'GeneralAbilitySoulLogic/getAbility': (2, ability_prefix),
                'PartyLogic/getBattleParty': (392, producer_suffix),
                'ItemLogic/get_name': (2, name_prefix),
                'AbilitySoulDetailDialog/initialize': (80, detail_message)}
    for label, (at, builder) in builders.items():
        body = editor.body(label)
        ops = asm.decode(body[5])
        if label == 'PartyLogic/getBattleParty':
            assert len(ops) == 393 and ops[at].name == 'returnvalue'
        elif label == 'AbilitySoulDetailDialog/initialize':
            assert len(ops) == 86 and ops[at].name == 'newobject'
            assert ops[at - 3].name == 'pushstring'
            assert editor.abc.s(ops[at - 3].args[0]) == 'message'
        else:
            assert [x.name for x in ops[:2]] == ['getlocal_0', 'pushscope']
        code = builder(editor, body[2])
        editor.insert(label, at, code)
        queued[label] = {'instruction_anchor': at, 'first_local': body[2],
                         'inserted_instruction_count': len(asm.assemble(code))}
    return {'restored_from_p0c': restored, 'queued': queued,
            'save_data_shape': 'weapon_rivens[String(item_id)] = contract record',
            'snapshot_shape': 'Array<Option<Array<Int>>>; [item_id,weapon_id,key,L,...]',
            'current_affixes_only': True, 'official_soul_ids_use_original_path':
            [1010001, 1060001, 1080001, 2020001]}
