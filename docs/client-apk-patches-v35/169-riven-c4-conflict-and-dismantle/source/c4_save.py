"""Replace the C1 extension's control flow with delete-then-update merging."""
import asm
from c1_lookup import number
from c2_common import DYNAMIC, get, queue


def merge(e, first):
    saved, updates, deleted, ident, row, index = range(first, first + 6)
    g = lambda n: ('getlocal', n)
    p = lambda n: ('setlocal', n)
    return [('getlocal_0',), ('getproperty', e.q('saveData')), *get(e, 'weapon_rivens'),
            p(saved), g(saved), ('iftrue', 'saved_ready'), ('newobject', 0), p(saved),
            ('getlocal_0',), ('getproperty', e.q('saveData')), e.string('weapon_rivens'),
            g(saved), ('setproperty', DYNAMIC), ('label', 'saved_ready'),
            ('getlocal_1',), *get(e, 'weapon_riven_deleted'), p(deleted), g(deleted),
            ('istype', e.q('Array')), ('iffalse', 'updates_begin'), number(e, 0), p(index),
            ('label', 'delete_test'), ('avm_label',), g(index), g(deleted),
            ('getproperty', e.q('length')), ('ifge', 'updates_begin'),
            g(deleted), g(index), ('getproperty', DYNAMIC), ('convert_i',), p(ident),
            g(ident), number(e, 16000001), ('iflt', 'delete_next'),
            g(ident), number(e, 16000999), ('ifgt', 'delete_next'),
            g(saved), g(ident), ('deleteproperty', DYNAMIC), ('pop',),
            ('pushtrue',), ('setlocal_2',), ('label', 'delete_next'),
            ('inclocal_i', index), ('jump', 'delete_test'), ('label', 'updates_begin'),
            ('getlocal_1',), *get(e, 'weapon_riven_list'), p(updates),
            g(updates), ('iffalse', 'merge_done'), number(e, 16000001), p(ident),
            ('label', 'merge_test'), ('avm_label',), g(ident), number(e, 16000999),
            ('ifgt', 'merge_done'), g(updates), g(ident), ('getproperty', DYNAMIC), p(row),
            g(row), ('iffalse', 'merge_next'), g(saved), g(ident), g(row),
            ('setproperty', DYNAMIC), ('pushtrue',), ('setlocal_2',), ('label', 'merge_next'),
            ('inclocal_i', ident), ('jump', 'merge_test'), ('label', 'merge_done'),
            ('getlocal_2',), ('returnvalue',)]


def queue_save_splices(e):
    label = 'PlayerLogic/applyCommonResponse'
    body = e.body(label)
    ops = asm.decode(body[5])
    hits = [i for i, op in enumerate(ops) if op.name == 'pushstring'
            and e.abc.s(op.args[0]) == 'weapon_rivens']
    assert len(hits) == 2
    at = hits[0] - 2
    assert ops[at].name == 'getlocal_0' and ops[at + 1].name == 'getproperty'
    assert e.abc.mn_name(ops[at + 1].args[0]) == 'saveData'
    return {'methods': {label: queue(e, label, merge(e, body[2]), at)},
            'order': ['weapon_riven_deleted', 'weapon_riven_list'],
            'same_slot_replacement': 'new record in list wins after stale slot deletion',
            'range': [16000001, 16000999], 'response_is_not_mutated': True,
            'original_common_fields': 'all original Option-based updates run before the C4 extension',
            'legacy_merge': 'C1 bytes retained, bypassed by a reversible inserted return'}
