"""P1 C1 login and common-response wiring; existing method-body insertions only."""
import hashlib
import asm
from c1_save_data import DYNAMIC, MIN_ITEM, MAX_ITEM, copy_dictionary, get_field

TARGETS = ('InitializeRealRemote/loadSuccessHandler',
           'InitializeRealRemote/restoreFinishedHandler',
           'RealRemoteService/earlySuccessHandler', 'PlayerLogic/applyCommonResponse')


def lock(e, label):
    body = e.body(label)
    e.locks[label] = {'sha': hashlib.sha256(body[5]).hexdigest(), 'header': body[1:5]}
    assert not body[7]
    return body, asm.decode(body[5])


def local_store(ops, n):
    matches = [i for i, x in enumerate(ops) if x.name == 'setlocal' and x.args == [n]]
    assert matches, (n, matches)
    at = matches[-1]
    assert ops[at - 1].name == 'coerce_a' and ops[at - 2].name == 'newobject'
    return at + 1


def queue_save_splices(e):
    get = lambda n: ('getlocal', n)
    put = lambda n: ('setlocal', n)
    num = lambda n: ('pushbyte', n) if 0 <= n <= 127 else ('pushint', e.pool.integer(n))
    field = lambda name: get_field(e, name)
    metadata = {}
    label = TARGETS[0]
    body, ops = lock(e, label)
    source, normalized = body[2], body[2] + 1
    code = [get(2), ('getproperty', e.q('rawData')), *field('data'),
            *field('user_weapon_riven_list'), put(source)]
    code += copy_dictionary(e, source, normalized, body[2] + 2, 'c1_load')
    code += [get(274), e.string('user_weapon_riven_list'), get(normalized),
             ('setproperty', DYNAMIC)]
    at = local_store(ops, 274)
    e.insert(label, at, code)
    metadata[label] = {'at': at, 'normalized_local': normalized, 'target_local': 274}

    label = TARGETS[1]
    body, ops = lock(e, label)
    at = local_store(ops, 97)
    code = [get(97), *field('player'), e.string('weapon_rivens'),
            get(2), *field('user_weapon_riven_list'), ('dup',), ('iftrue', 'c1_restore_set'),
            ('pop',), ('newobject', 0), ('label', 'c1_restore_set'), ('setproperty', DYNAMIC)]
    e.insert(label, at, code)
    metadata[label] = {'at': at, 'target_local': 97}

    label = TARGETS[2]
    body, ops = lock(e, label)
    source, normalized, deleted = body[2], body[2] + 1, body[2] + 11
    code = [get(2), ('getproperty', e.q('rawData')), *field('data'),
            *field('weapon_riven_list'), put(source)]
    code += copy_dictionary(e, source, normalized, body[2] + 2, 'c1_common')
    code += [get(28), e.string('weapon_riven_list'), get(normalized), ('setproperty', DYNAMIC),
             get(2), ('getproperty', e.q('rawData')), *field('data'),
             *field('weapon_riven_deleted'), put(deleted), get(deleted),
             ('istype', e.q('Array')), ('iftrue', 'c1_deleted_array'),
             ('newarray', 0), put(deleted), ('label', 'c1_deleted_array'),
             get(28), e.string('weapon_riven_deleted'), get(deleted), ('setproperty', DYNAMIC)]
    at = local_store(ops, 28)
    e.insert(label, at, code)
    metadata[label] = {'at': at, 'target_local': 28}

    label = TARGETS[3]
    body, ops = lock(e, label)
    saved, updates, deleted, ident, row, index = range(body[2], body[2] + 6)
    assert ops[-2].name == 'getlocal_2' and ops[-1].name == 'returnvalue'
    code = [('getlocal_0',), ('getproperty', e.q('saveData')), *field('weapon_rivens'),
            put(saved), get(saved), ('iftrue', 'c1_saved_ready'), ('newobject', 0), put(saved),
            ('getlocal_0',), ('getproperty', e.q('saveData')), e.string('weapon_rivens'),
            get(saved), ('setproperty', DYNAMIC), ('label', 'c1_saved_ready'),
            ('getlocal_1',), *field('weapon_riven_list'), put(updates),
            get(updates), ('iffalse', 'c1_delete_begin'), num(MIN_ITEM), put(ident),
            ('label', 'c1_merge_test'), ('avm_label',), get(ident), num(MAX_ITEM),
            ('ifgt', 'c1_delete_begin'), get(updates), get(ident), ('getproperty', DYNAMIC),
            put(row), get(row), ('iffalse', 'c1_merge_next'),
            get(saved), get(ident), get(row), ('setproperty', DYNAMIC),
            ('pushtrue',), ('setlocal_2',), ('label', 'c1_merge_next'),
            ('inclocal_i', ident), ('jump', 'c1_merge_test'), ('label', 'c1_delete_begin'),
            ('getlocal_1',), *field('weapon_riven_deleted'), put(deleted), get(deleted),
            ('istype', e.q('Array')), ('iffalse', 'c1_merge_done'), num(0), put(index),
            ('label', 'c1_delete_test'), ('avm_label',), get(index), get(deleted),
            ('getproperty', e.q('length')), ('ifge', 'c1_merge_done'),
            get(deleted), get(index), ('getproperty', DYNAMIC), ('convert_i',), put(ident),
            get(ident), num(MIN_ITEM), ('iflt', 'c1_delete_next'),
            get(ident), num(MAX_ITEM), ('ifgt', 'c1_delete_next'),
            get(saved), get(ident), ('deleteproperty', DYNAMIC), ('pop',),
            ('pushtrue',), ('setlocal_2',), ('label', 'c1_delete_next'),
            ('inclocal_i', index), ('jump', 'c1_delete_test'), ('label', 'c1_merge_done')]
    e.insert(label, len(ops) - 2, code)
    metadata[label] = {'at': len(ops) - 2, 'saved_local': saved,
                       'update_order': 'replace listed records, then delete listed IDs'}
    return {'field': 'weapon_rivens', 'shape': 'Object<string item_id, WeaponRivenRecord>',
            'instance_range': [MIN_ITEM, MAX_ITEM], 'methods': metadata,
            'pending_draw_id_source': 'server-wt/src/lib/weapon-riven/model.ts:9 (string)'}
