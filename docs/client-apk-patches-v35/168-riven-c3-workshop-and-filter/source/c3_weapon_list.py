"""Enumerate revealed instances in a separate weapon-list row domain."""
from c1_lookup import number
from c2_common import DYNAMIC, get, prefix
from c3_weapon_common import ROW_DOMAIN, RIVEN_MIN, RIVEN_MAX, mode, rows, refresh


def enumerate_rows(e, first):
    from c3_filter_engine import emit_filter_record
    q = e.q
    records, ident, record, result, setting, weapon = range(first, first + 6)
    g = lambda n: ('getlocal', n)
    p = lambda n: ('setlocal', n)
    code = mode(e, 'original') + [('newarray', 0), p(result), *rows(e), p(records),
            g(records), ('iffalse', 'done'), ('getlocal_0',), ('getproperty', q('filterSetting')),
            p(setting), number(e, RIVEN_MIN), p(ident), ('label', 'next'), ('avm_label',),
            g(ident), number(e, RIVEN_MAX), ('ifgt', 'done'),
            g(records), g(ident), ('getproperty', DYNAMIC), p(record),
            g(record), ('iffalse', 'skip'), ('getlocal_0',), ('getproperty', q('globalLogic')),
            g(record), *get(e, 'weapon_id'), ('convert_i',),
            ('callproperty', q('getGeneralEquipment'), 1), p(weapon)]
    code += emit_filter_record(e, setting, record, weapon, first + 6, 'skip', 'weapon_filter')
    code += [g(result), g(ident), number(e, ROW_DOMAIN), ('bitor',),
             ('callpropvoid', q('http://adobe.com/AS3/2006/builtin::push'), 1),
             ('label', 'skip'), ('inclocal_i', ident), ('jump', 'next'),
             ('label', 'done'), g(result), ('returnvalue',), ('label', 'original')]
    return code


def thumbnail(e, first):
    q = e.q
    ident, record, weapon = range(first, first + 3)
    g = lambda n: ('getlocal', n)
    from c3_weapon_common import row_guard
    code = row_guard(e, [('getlocal_1',)], 'original')
    code += [('getlocal_1',), number(e, 0xFFFFFF), ('bitand',), ('setlocal', ident),
             *rows(e), g(ident), ('getproperty', DYNAMIC), ('setlocal', record),
             ('getlocal_0',), ('getproperty', q('globalLogic')), g(record), *get(e, 'weapon_id'),
             ('convert_i',), ('callproperty', q('getGeneralEquipment'), 1), ('setlocal', weapon),
             e.string('wfxRiven'), ('pushtrue',), e.string('equipment'), e.string('id'),
             ('getlocal_1',), ('newobject', 1), e.string('item_id'), g(ident),
             e.string('record'), g(record), e.string('weapon'), g(weapon),
             e.string('name'), g(weapon), ('callproperty', q('get_name'), 0),
             e.string('裂罅'), ('add',), e.string('selected'), ('pushfalse',),
             ('newobject', 7), ('returnvalue',), ('label', 'original')]
    return code


def sort_rows(e, first):
    from c3_filter_engine import emit_sort_ids
    q = e.q
    ids, records, setting = range(first, first + 3)
    code = mode(e, 'original') + [('getlocal_0',), ('getproperty', q('equipmentIds')),
            ('setlocal', ids), *rows(e), ('setlocal', records),
            ('getlocal_0',), ('getproperty', q('filterSetting')), ('setlocal', setting)]
    code += emit_sort_ids(e, ids, records, setting, first + 3, 'weapon_sort')
    code += [('getlocal_0',), ('getlocal', ids), ('setproperty', q('equipmentIds')),
             ('getlocal_0',), ('getproperty', q('viewSceneOrder')), ('getlocal', ids),
             ('callpropvoid', q('sortThumbnails'), 1), ('returnvoid',), ('label', 'original')]
    return code


def filter_apply(e, first):
    return mode(e, 'original') + [
        ('getlocal_0',), ('getlocal_1',), ('setproperty', e.q('filterSetting')),
        ('getlocal_0',), ('pushfalse',), ('setproperty', e.q('forcedSearchBySameSettingOnce')),
        *refresh(e), ('returnvoid',), ('label', 'original')]


def async_complete(e, first):
    # Recompute against current settings: a completion from before a category
    # roundtrip must not replace a newer equipment query either.
    q = e.q
    ids, selected, index = range(first, first + 3)
    g = lambda n: ('getlocal', n)
    return [('getlocal_1',), ('callpropvoid', q('close'), 0),
            *mode(e, 'equipment'), ('returnvoid',), ('label', 'equipment'),
            ('getlocal_0',), ('callproperty', q('getFilteredEquipmentList'), 0),
            ('setlocal', ids), ('getlocal_0',), g(ids), ('setproperty', q('equipmentIds')),
            ('newarray', 0), ('setlocal', selected), number(e, 0), ('setlocal', index),
            ('label', 'current_loop'), ('avm_label',), g(index), g(ids),
            ('getproperty', q('length')), ('ifge', 'current_done'),
            g(selected), ('getlocal_0',), ('getproperty', q('player')),
            g(ids), g(index), ('getproperty', DYNAMIC), ('convert_i',),
            ('callproperty', q('getOwnedEquipment'), 1),
            ('callpropvoid', q('http://adobe.com/AS3/2006/builtin::push'), 1),
            ('inclocal_i', index), ('jump', 'current_loop'), ('label', 'current_done'),
            ('getlocal_0',), ('getproperty', q('bulkSelector')),
            g(selected), ('callpropvoid', q('refreshShownEquipments'), 1),
            ('getlocal_0',), ('callpropvoid', q('rebuildAllThumbnails'), 0), ('returnvoid',)]


def register_rows(e, first):
    q = e.q
    ids, index, key = range(first, first + 3)
    g = lambda n: ('getlocal', n)
    return [('getlocal_0',), ('getproperty', q('equipmentIds')), ('setlocal', ids),
            number(e, 0), ('setlocal', index), ('label', 'buttons_loop'), ('avm_label',),
            g(index), g(ids), ('getproperty', q('length')), ('ifge', 'buttons_done'),
            g(ids), g(index), ('getproperty', DYNAMIC), ('setlocal', key),
            ('getlocal_0',), ('getproperty', q('buttonGroup')), g(key),
            ('callproperty', q('exists'), 1), ('iftrue', 'buttons_next'),
            ('getlocal_0',), ('getproperty', q('buttonGroup')), g(key),
            ('callpropvoid', q('append'), 1), ('label', 'buttons_next'),
            ('inclocal_i', index), ('jump', 'buttons_loop'), ('label', 'buttons_done')]


def queue_list(e):
    return {f'EquipmentListScene/{name}': prefix(e, f'EquipmentListScene/{name}', fn)
            for name, fn in [('getFilteredEquipmentList', enumerate_rows),
            ('toThumbnailData', thumbnail), ('sortEquipmentThumbnails', sort_rows),
            ('filterDialogOkHandler', filter_apply),
            ('getFilteredEquipmentListAsyncCompleted', async_complete),
            ('rebuildAllThumbnails', register_rows)]}
