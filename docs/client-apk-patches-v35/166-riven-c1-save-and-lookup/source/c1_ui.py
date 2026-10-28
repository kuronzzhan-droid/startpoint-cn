"""C1 name and detail-message splice builders."""
from c1_lookup import dynamic_get, equipment_name, lookup
from snapshot_aggregate import OPTION


def name_prefix(e, first_local):
    ident, scratch, record = range(first_local, first_local + 3)
    code = [('getlocal_0',), ('getproperty', e.q('id')), ('setlocal', ident)]
    code += lookup(e, ident, scratch, record, 'name_original')
    code += equipment_name(e, 0, record)
    code += [e.string('裂罅'), ('add',), ('returnvalue',), ('label', 'name_original')]
    return code


def detail_message(e, first_local):
    ident, scratch, record, original = range(first_local, first_local + 4)
    code = [('setlocal', original), ('getlocal_1',),
            ('getproperty', e.q('id')), ('setlocal', ident)]
    code += lookup(e, ident, scratch, record, 'message_original')
    code += [('getlex', e.q(OPTION)), e.string('绑定武器：')]
    code += equipment_name(e, 1, record)
    code += [('add',), e.string('\n已重抽 '), ('add',), ('getlocal', record)]
    code += dynamic_get(e, 'roll_count')
    code += [('convert_i',), ('add',), e.string(' 次'), ('add',),
             ('callproperty', e.q('Some'), 1), ('jump', 'message_done'),
             ('label', 'message_original'), ('getlocal', original),
             ('label', 'message_done')]
    return code
