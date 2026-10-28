"""Explicit C1-C22 source replay registry, with the inherited P0 prerequisites."""
from importlib import import_module
from bootstrap import ROOT, sha
import asm

STAGES = {
    1: [('c1_save', 'queue_save_splices'), ('c1_types', 'queue_type_splices'),
        ('c1_dynamic', 'queue_dynamic_splices')],
    2: [('c2_page', 'queue_page_splices'), ('c2_transaction', 'queue_transaction_splices'),
        ('c2_remote', 'queue_remote_splices'), ('c2_presentation', 'queue_presentation_splices')],
    3: [('c3_weapon', 'queue_weapon_splices'), ('c3_filter', 'queue_filter_splices'),
        ('c3_inventory', 'queue_inventory_splices')],
    4: [('c4_requests', 'queue_requests_splices'), ('c4_save', 'queue_save_splices'),
        ('c4_party', 'queue_party_splices'), ('c4_conflict', 'queue_conflict_splices'),
        ('c4_dismantle', 'queue_dismantle_splices'), ('c4_ranges', 'queue_range_splices')],
    5: [],  # Historical local endpoint/admission change is explicitly excluded.
    6: [('c6_build', 'queue_guard')],
    7: [('c7_rows', 'queue_rows'), ('c7_button', 'queue_button')],
    8: [('c8_inventory', 'queue_inventory'), ('c8_soul', 'queue_soul'),
        ('c8_layout', 'queue_layout'), ('c8_navigation', 'queue_navigation'),
        ('c8_splices', 'join_shared_suffix')],
    9: [(f'c9_{m}', f'queue_{m}') for m in ('data', 'settlement', 'details', 'actions', 'lists')]
       + [('c9_lists_seen', 'queue_seen'), ('c9_party', 'queue_party'), ('c9_entry', 'queue_entry'),
          ('c9_splices', 'join_shared_splices')],
    10: [(f'c10_{m}', f'queue_{m}') for m in ('lifecycle', 'shop', 'empty', 'copy')]
        + [('c10_splices', 'join_shared_splices')],
    11: [(f'c11_{m}', f'queue_{m}') for m in ('icons', 'quality', 'settlement')]
        + [('c11_splices', 'join_shared_splices')],
    12: [('c12_layout', 'apply'), ('c12_badge', 'apply'), ('c12_splices', 'join_shared_splices')],
    13: [('c13_soul', 'apply'), ('c13_layout', 'apply'), ('c12_splices', 'join_shared_splices')],
    14: [('c14_text', 'apply'), ('c12_splices', 'join_shared_splices')],
    15: [('c15_guards', 'apply')],
    16: [('c16_richtext', 'apply')],
    17: [('c17_cost', 'apply'), ('c17_official', 'apply'), ('c17_splices', 'join')],
    18: [('c18_values', 'apply'), ('c18_party_gate', 'apply'), ('c18_quality', 'apply')],
    19: [('c19_race', 'apply'), ('c19_ui', 'apply'), ('c19_soul_display', 'apply')],
    20: [('c20_layout', 'apply')],
    21: [('c21_layout', 'apply')],
    22: [('c22_types', 'apply'), ('c22_consumer', 'apply'), ('c22_protocol', 'apply')],
}


def prerequisites(e):
    from types_patch import add_type_splices
    from snapshot_inline import consumer
    label = 'BattleCharacterLogic/getAbilitySoulAbility'
    body = e.body(label)
    ops = asm.decode(body[5])
    assert [o.name for o in ops[:2]] == ['getlocal_0', 'pushscope']
    e.locks[label] = {'sha': sha(body[5]), 'header': body[1:5]}
    e.insert(label, 2, consumer(e, body[2]))
    return {'types': add_type_splices(e), 'consumer': label,
            'omitted_superseded_p0_literals': ['GeneralAbilitySoulLogic/getAbility',
                                             'PartyLogic/getBattleParty']}


def queue(stage, editor):
    if stage == 0:
        return prerequisites(editor)
    if stage == 3:
        import c3_filter_engine as m
        m.CATALOG = ROOT.parent / 'library/generator/out-v1/weapon_riven_affixes.json'
        m.LOCK = ROOT.parent / 'library/generator/out-v1/affix_keys.lock.json'
    if stage == 8:
        import c3_filter_engine as m
        m.CATALOG = ROOT.parent / 'client-p1/build-c8/audit/c8-layout/weapon_riven_affixes.json'
        m.LOCK = ROOT.parent / 'client-p1/build-c8/audit/c8-layout/affix_keys.lock.json'
    result = {m: getattr(import_module(m), fn)(editor) for m, fn in STAGES[stage]}
    if stage == 22:
        from c22_restore import apply
        from c22_catalog import CATALOG_ID
        result['c22_restore'] = apply(editor, CATALOG_ID)
    if stage == 5:
        result['identity'] = 'Keep every original 1008091 endpoint and admission ABC byte unchanged.'
    return result
