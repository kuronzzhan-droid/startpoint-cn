"""Fail closed for reserved instances; preserve native ordinary-soul bytecode."""
import copy
import asm
from bootstrap import sha
from c1_lookup import number
from c2_common import DYNAMIC, OPTION
from c22_catalog import CATALOG_ID, AFFIX_KEYS
from c22_protocol_common import identifier

TARGET = 'BattleCharacterLogic/getAbilitySoulAbility'
BASE_SHA = '9a93ca497598e767152e8ec901169f386a738bf6fbc73d8d1f9dd395ea10d5a1'


def shift(block, delta):
    result = copy.deepcopy(block)
    for op in result:
        if op.target is not None:
            op.target += delta
        if op.cases is not None:
            op.default += delta
            op.cases = [target + delta for target in op.cases]
    return result


def guard(e, first):
    ident, values, slots, row, index, count, value, pair = range(first, first + 8)
    g = lambda n: ('getlocal', n)
    p = lambda n: ('setlocal', n)
    n = lambda v: number(e, v)
    gp = lambda field: ('getproperty', e.q(field))
    dg = lambda field: [e.string(field), ('getproperty', DYNAMIC)]
    fail = 'c22_none'
    code = [('getlocal_0',), gp('abilitySoul'), gp('index'), n(0), ('ifne', 'c22_ordinary'),
            ('getlocal_0',), gp('abilitySoul'), gp('params'), n(0), ('getproperty', DYNAMIC),
            ('callproperty', e.q('get_abilitySoulId'), 0), p(ident),
            g(ident), n(16000001), ('iflt', 'c22_ordinary'),
            g(ident), n(16000999), ('ifgt', 'c22_ordinary'),
            g(ident), n(16000900), ('ifeq', 'c22_ordinary'),
            ('getlocal_0',), gp('party'), p(values), g(values), ('iffalse', fail),
            g(values), gp('values'), p(values), g(values), ('iffalse', fail)]
    # Missing optional context is the established single-player P1 path.
    # A partially present context can never silently acquire single semantics.
    code += [g(values), *dg('weapon_riven_scope'), p(value),
             g(value), ('pushnull',), ('ifeq', 'c22_single'),
             g(value), e.string('multi-v1'), ('ifstrictne', fail),
             g(values), *dg('weapon_riven_mode'), n(1), ('ifstrictne', fail),
             g(values), *dg('weapon_riven_catalog'), e.string(CATALOG_ID), ('ifstrictne', fail),
             g(values), *dg('weapon_riven_snapshot_id'), p(value),
             *identifier(e, value, fail),
             g(values), *dg('weapon_riven_reason'), e.string(''), ('ifstrictne', fail),
             ('jump', 'c22_context_done'), ('label', 'c22_single')]
    for field in ('weapon_riven_mode', 'weapon_riven_catalog',
                  'weapon_riven_snapshot_id', 'weapon_riven_reason'):
        code += [g(values), *dg(field), ('pushnull',), ('ifne', fail)]
    code += [('label', 'c22_context_done'), g(values), *dg('weapon_rivens'), p(slots),
             g(slots), ('istype', e.q('Array')), ('iffalse', fail),
             g(slots), gp('length'), n(3), ('ifne', fail),
             ('getlocal_0',), gp('index'), p(index),
             g(index), n(0), ('iflt', fail), g(index), n(3), ('ifge', fail),
             g(index), ('convert_i',), g(index), ('ifstrictne', fail),
             g(slots), g(index), ('getproperty', DYNAMIC), p(row),
             g(row), ('iffalse', fail), g(row), gp('index'), n(0), ('ifstrictne', fail),
             g(row), gp('params'), p(row),
             g(row), ('istype', e.q('Array')), ('iffalse', fail),
             g(row), gp('length'), n(1), ('ifne', fail),
             g(row), n(0), ('getproperty', DYNAMIC), p(row),
             g(row), ('istype', e.q('Array')), ('iffalse', fail),
             g(row), gp('length'), p(count),
             g(count), n(4), ('iflt', fail), g(count), n(10), ('ifgt', fail),
             g(count), n(2), ('modulo',), n(0), ('ifne', fail),
             g(row), n(0), ('getproperty', DYNAMIC), g(ident), ('ifstrictne', fail),
             n(0), p(pair), ('label', 'c22_scalar_loop'), ('avm_label',),
             g(pair), g(count), ('ifge', 'c22_scalars_done'),
             g(row), g(pair), ('getproperty', DYNAMIC), p(value),
             g(value), ('typeof',), e.string('number'), ('ifne', fail),
             g(value), ('convert_i',), g(value), ('ifstrictne', fail),
             g(value), n(1), ('iflt', fail),
             ('inclocal_i', pair), ('jump', 'c22_scalar_loop'),
             ('label', 'c22_scalars_done'), n(2), p(pair),
             ('label', 'c22_pair_loop'), ('avm_label',),
             g(pair), g(count), ('ifge', 'c22_valid'),
             g(row), g(pair), n(1), ('add_i',), ('getproperty', DYNAMIC),
             n(100), ('ifgt', fail), g(row), g(pair), ('getproperty', DYNAMIC), p(value)]
    for key in AFFIX_KEYS:
        code += [g(value), n(key), ('ifeq', 'c22_key_ok')]
    code += [('jump', fail), ('label', 'c22_key_ok'),
             g(pair), n(2), ('add_i',), p(pair), ('jump', 'c22_pair_loop'),
             ('label', fail), ('getlex', e.q(OPTION)), gp('None'), ('returnvalue',),
             ('label', 'c22_valid'), ('jump', 'END'), ('label', 'c22_ordinary')]
    return asm.assemble(code)


def apply(editor):
    e, body = editor, editor.body(TARGET)
    assert sha(body[5]) == BASE_SHA, 'C22 consumer requires the exact C21 body'
    ops = asm.decode(body[5])
    assert len(ops) == 243 and len(body[5]) == 579
    original_at = ops[6].target
    assert original_at == 195 and all(ops[i].target == original_at for i in (17, 21, 30, 37, 41, 47, 51, 58, 62, 68, 73))
    native = shift(ops[original_at:], -original_at)
    prefix = guard(e, body[2])
    # Ordinary branches enter a copy of the original suffix. Only the final
    # valid-instance jump crosses that suffix and reaches inherited aggregation.
    assert prefix[-1].name == 'jump' and prefix[-1].target == len(prefix)
    prefix[-1].target = len(prefix) + len(native)
    block = prefix + shift(native, len(prefix))
    e.locks[TARGET] = {'sha': sha(body[5]), 'header': list(body[1:5])}
    e.insertions.setdefault(TARGET, []).append((2, block, asm.ENTER))
    assert not e.new_methods and not e.traits
    return {'method': TARGET, 'at': 2, 'baseline_sha256': sha(body[5]),
            'instructions': len(block), 'ordinary_suffix_sha256': sha(asm.encode(native)[0]),
            'ordinary_suffix_instructions': len(native), 'instance_range': [16000001, 16000999],
            'affix_key_count': len(AFFIX_KEYS), 'single_player_context_optional': True,
            'invalid_instance_result': 'Option.None', 'reads_local_inventory': False,
            'aggregation': 'unchanged inherited C21 party-and-slot consumer'}
