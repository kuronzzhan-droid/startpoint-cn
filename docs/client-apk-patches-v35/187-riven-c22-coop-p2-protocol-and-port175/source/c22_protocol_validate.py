"""Inline strict member/context validator and scalar canonical serializer."""
from c2_common import DYNAMIC, get, set_
from c22_protocol_common import (CONTEXT_FIELDS, BUILTIN, num, gp, call, at,
                                  array, integer, identifier, append)
from c22_protocol_slots import slots


def validate(e, roster, first, fail, tag, catalog_id, assets=None, source=False):
    names = ('snapshot canonical mode rows has_context i mate party catalog real_seen '
             'is_com ident identities connection connections scratch value slot_rows '
             'soul_table equipment_table reason').split()
    loc = dict(zip(names, range(first, first + len(names))))
    g = lambda name: ('getlocal', loc[name])
    p = lambda name: ('setlocal', loc[name])
    label = lambda name: tag + '_' + name
    branch = lambda op, name: (op, label(name))
    code = [e.string('invalid'), p('snapshot'), e.string(''), p('catalog'), e.string(''), p('reason'),
            *num(e, 0), p('mode'), ('pushfalse',), p('has_context'),
            *num(e, 0), p('real_seen'), ('newarray', 0), p('rows'),
            ('newarray', 0), p('identities'), ('newarray', 0), p('connections'),
            *array(e, roster, fail), ('getlocal', roster), *gp(e, 'length'),
            *num(e, 1), ('iflt', fail), ('getlocal', roster), *gp(e, 'length'),
            *num(e, 3), ('ifgt', fail), *num(e, 0), p('i'),
            ('label', label('context_loop')), ('avm_label',),
            g('i'), ('getlocal', roster), *gp(e, 'length'), branch('ifge', 'context_done'),
            ('getlocal', roster), g('i'), ('getproperty', DYNAMIC), p('mate'),
            g('mate'), ('iffalse', fail), g('mate'), *gp(e, 'party'), p('party'),
            g('party'), ('iffalse', fail), g('mate'), *gp(e, 'comId'), p('is_com'),
            g('is_com'), branch('iftrue', 'com_context'),
            g('party'), *gp(e, 'weapon_riven_scope'), p('value'),
            g('real_seen'), branch('iftrue', 'existing_context'),
            g('value'), ('pushnull',), branch('ifeq', 'existing_context'),
            ('pushtrue',), p('has_context'), g('party'), *gp(e, 'weapon_riven_snapshot_id'),
            p('snapshot'), *identifier(e, loc['snapshot'], fail),
            g('party'), *gp(e, 'weapon_riven_catalog'), p('catalog'),
            *identifier(e, loc['catalog'], fail),
            g('party'), *gp(e, 'weapon_riven_mode'), p('mode'),
            *integer(e, loc['mode'], 0, 1, fail),
            g('party'), *gp(e, 'weapon_riven_reason'), p('reason'),
            g('reason'), ('istype', e.q('String')), ('iffalse', fail),
            g('mode'), branch('iffalse', 'disabled_catalog'),
            g('reason'), e.string(''), ('ifne', fail),
            g('catalog'), e.string(catalog_id), ('ifne', fail), branch('jump', 'existing_context'),
            ('label', label('disabled_catalog')), g('catalog'), e.string('none'), ('ifne', fail),
            *identifier(e, loc['reason'], fail),
            ('label', label('existing_context')), ('inclocal_i', loc['real_seen']),
            g('has_context'), branch('iffalse', 'no_context'),
            g('value'), e.string('multi-v1'), ('ifne', fail)]
    for key, name in (('weapon_riven_snapshot_id', 'snapshot'),
                      ('weapon_riven_catalog', 'catalog'), ('weapon_riven_mode', 'mode'),
                      ('weapon_riven_reason', 'reason')):
        code += [g('party'), *gp(e, key), g(name), ('ifne', fail)]
    code += [branch('jump', 'context_next'), ('label', label('com_context'))]
    for key in (*CONTEXT_FIELDS, 'weapon_rivens'):
        code += [g('party'), *gp(e, key), ('pushnull',), ('ifne', fail)]
    code += [branch('jump', 'context_next'), ('label', label('no_context'))]
    for key in CONTEXT_FIELDS:
        code += [g('party'), *gp(e, key), ('pushnull',), ('ifne', fail)]
    code += [('label', label('context_next')), ('inclocal_i', loc['i']),
             branch('jump', 'context_loop'), ('label', label('context_done')),
             g('real_seen'), ('iffalse', fail), g('has_context'), branch('iftrue', 'tables'),
             e.string('none'), p('catalog'), ('label', label('tables'))]
    if assets is not None:
        code += [g('mode'), branch('iffalse', 'tables_done')]
        for name, table in (('soul_table', 'AbilitySoulTable'), ('equipment_table', 'EquipmentTable')):
            code += [*assets, ('getlex', e.q('pinball.master.generated::' + table)),
                     *call(e, 'getMasterTableMaybe', 1), p(name), g(name), ('iffalse', fail),
                     g(name), *call(e, 'get_data', 0), p(name), g(name), ('iffalse', fail)]
        code += [('label', label('tables_done'))]
    code += [e.string('WFR2C1'), p('canonical'),
             *append(e, loc['canonical'], [g('catalog')]),
             *append(e, loc['canonical'], [g('mode')]),
             *append(e, loc['canonical'], [('getlocal', roster), *gp(e, 'length')]),
             *num(e, 0), p('i'), ('label', label('member_loop')), ('avm_label',),
             g('i'), ('getlocal', roster), *gp(e, 'length'), branch('ifge', 'done'),
             ('getlocal', roster), g('i'), ('getproperty', DYNAMIC), p('mate'),
             g('mate'), *gp(e, 'party'), p('party'),
             g('mate'), *gp(e, 'id' if source else 'connectionId'), p('connection'),
             g('connection'), ('istype', e.q('String')), ('iffalse', fail),
             g('connection'), *gp(e, 'length'), ('iffalse', fail),
             g('connections'), g('connection'), *call(e, BUILTIN + 'indexOf', 1),
             *num(e, 0), ('ifge', fail), g('connections'), g('connection'),
             *call(e, BUILTIN + 'push', 1, True),
             g('mate'), *gp(e, 'comId'), p('is_com'),
             g('is_com'), branch('iftrue', 'com_identity'),
             g('mate'), *gp(e, 'viewerId'), p('ident')]
    if source:
        code += [g('ident'), ('iffalse', fail), g('ident'), *gp(e, 'index'),
                 *num(e, 0), ('ifne', fail), g('ident'), *gp(e, 'params'), p('scratch'),
                 *array(e, loc['scratch'], fail, 1), *at(e, loc['scratch'], 0), p('ident')]
    code += [*integer(e, loc['ident'], 1, 9007199254740991, fail), e.string('V'),
             p('value'), branch('jump', 'identity_done'), ('label', label('com_identity')),
             g('is_com'), p('ident'), *integer(e, loc['ident'], 1, 2147483647, fail),
             e.string('C'), p('value'), ('label', label('identity_done')),
             *append(e, loc['canonical'], [g('value')]),
             *append(e, loc['canonical'], [g('ident')]),
             g('value'), g('ident'), ('add',), p('value'),
             g('identities'), g('value'), *call(e, BUILTIN + 'indexOf', 1),
             *num(e, 0), ('ifge', fail), g('identities'), g('value'),
             *call(e, BUILTIN + 'push', 1, True)]
    slotcode, end = slots(e, loc, first + len(names), fail, label('slots'), assets is not None)
    code += slotcode
    code += [g('rows'), g('slot_rows'), *call(e, BUILTIN + 'push', 1, True),
             ('inclocal_i', loc['i']), branch('jump', 'member_loop'),
             ('label', label('done')), g('canonical'), *gp(e, 'length'),
             g('snapshot'), *gp(e, 'length'), ('add',), *num(e, 8), ('add',),
             *num(e, 4096), ('ifgt', fail)]
    loc['next_local'] = end
    return code, loc
