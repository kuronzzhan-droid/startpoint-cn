"""Extend every C3 riven bound with reversible, method-local stack splices."""
import asm
import bodies
from c1_lookup import number
from c2_common import queue

RIVEN_MIN, OLD_MAX, RIVEN_MAX = 16000001, 16000200, 16000999
ROW_DOMAIN = 0x05000000

# These are instruction positions in the SHA-locked C3 main ABC, not inferred
# matches for arbitrary occurrences of 200. Refuse an unexpected occurrence.
POSITIONS = {
    'RealRemoteService/earlySuccessHandler': [(7145, 'loop')],
    'ItemLogic/get_name': [(9, 'instance')],
    'GeneralAbilitySoulLogic/getAbility': [(10, 'instance')],
    'PartyLogic/getBattleParty': [(423, 'instance')],
    'PlayerLogic/applyCommonResponse': [(211, 'loop'), (250, 'instance')],
    'AbilitySoulDetailDialog/initialize': [(88, 'instance'), (181, 'instance')],
    'ExBoostDrawRealRemote/successHandler': [(8, 'remote')],
    'ExBoostSelectRealRemote/successHandler': [(8, 'remote')],
    'InitializeRealRemote/loadSuccessHandler': [(20186, 'loop')],
    'AbilitySoulThumbnailListRepository/translate': [(159, 'inventory')],
    'EquipmentListScene/toThumbnailData': [(6, 'encoded')],
    'EquipmentListScene/openDetailDialog': [(6, 'encoded'), (16, 'instance')],
    'EquipmentListScene/getFilteredEquipmentList': [(24, 'loop')],
    'EquipmentListScene/buttonClicked': [(82, 'encoded')],
    'ExBoostWindow/run': [(27, 'negative_status')],
    'ItemTableTranslator/translateFromItem': [(136, 'inventory')],
    'ItemTableTranslator/translateFromCategorizedItems': [(187, 'inventory')],
}


def numeric_value(abc, op):
    pool = {'pushint': 'ints', 'pushuint': 'uints',
            'pushdouble': 'doubles'}.get(op.name)
    return getattr(abc, pool)[op.args[0]] if pool else None


def upper_references(abc):
    """Inventory all old upper bounds, including signed and encoded forms."""
    labels = bodies.label_map(abc)
    values = {OLD_MAX, -OLD_MAX, ROW_DOMAIN + OLD_MAX}
    found = []
    for index, body in enumerate(abc.bodies):
        for position, op in enumerate(asm.decode(body[5])):
            value = numeric_value(abc, op)
            if value in values:
                found.append((labels.get(index), position, value, index))
    return found


def describe(abc, position, op):
    result = {'instruction': position, 'opcode': op.name, 'args': op.args}
    value = numeric_value(abc, op)
    if value is not None:
        result['value'] = value
    if op.target is not None:
        result['target'] = op.target
    return result


def queue_range_splices(e):
    observed = upper_references(e.abc)
    expected = {(label, position, ROW_DOMAIN + OLD_MAX if kind == 'encoded' else OLD_MAX)
                for label, sites in POSITIONS.items() for position, kind in sites}
    assert {(a, b, c) for a, b, c, _ in observed} == expected, observed
    rows = []
    for label, position, old, body_index in observed:
        kind = dict(POSITIONS[label])[position]
        body = e.abc.bodies[body_index]
        ops = asm.decode(body[5])
        assert ops[position].name == 'pushint'
        if kind == 'negative_status':
            assert [o.name for o in ops[position+1:position+3]] == ['negate_i', 'iflt']
            assert numeric_value(e.abc, ops[position+4]) == RIVEN_MIN
            assert ops[position+6].name == 'ifgt'
        else:
            assert ops[position+1].name == 'ifgt'
            lower = ROW_DOMAIN + RIVEN_MIN if kind == 'encoded' else (
                RIVEN_MIN - 1 if kind == 'inventory' else RIVEN_MIN)
            back = 4 if kind in ('loop', 'remote') else 3
            assert numeric_value(e.abc, ops[position-back]) == lower, (label, position)
            assert ops[position-back+1].name == ('setlocal' if kind == 'loop' else 'iflt')
        new = ROW_DOMAIN + RIVEN_MAX if kind == 'encoded' else RIVEN_MAX
        # Keep the original pushint and pool prefix byte-for-byte. All paths
        # consume the replacement before the inherited compare/negate opcode.
        queue(e, label, [('pop',), number(e, new)], at=position+1)
        rows.append({'body': body_index, 'label': label, 'kind': kind,
                     'c3_instruction': position, 'insert_at': position+1,
                     'old_upper': old, 'new_upper': new,
                     'constant_pool_index': ops[position].args[0],
                     'context': [describe(e.abc, i, ops[i]) for i in
                                 range(max(0, position-5), min(len(ops), position+7))]})
    assert not e.new_methods and not e.traits
    return {'status': 'queued', 'occurrence_count': len(rows),
            'method_count': len(POSITIONS), 'range': [RIVEN_MIN, RIVEN_MAX],
            'negative_status_range': [-RIVEN_MAX, -RIVEN_MIN],
            'inventory_includes_unknown': RIVEN_MIN - 1,
            'encoded_row_domain': ROW_DOMAIN, 'all_old_bounds_accounted_for': True,
            'constant_pool_prefix_preserved': True, 'positions': rows}
