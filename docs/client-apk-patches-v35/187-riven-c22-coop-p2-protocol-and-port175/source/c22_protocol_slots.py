"""Strict three-slot BattleParty validation, emitted inside existing methods."""
from c2_common import DYNAMIC
from c22_protocol_common import (BUILTIN, num, gp, call, at, array, integer,
                                  append, option, is_instance)


def slots(e, parent, first, fail, tag, check_assets):
    names = ('slot opt scratch scalar soul rows_array row terms term rowcopy '
             'instance_count is_card fields field_index').split()
    loc = {**parent, **dict(zip(names, range(first, first + len(names))))}
    g = lambda name: ('getlocal', loc[name])
    p = lambda name: ('setlocal', loc[name])
    L = lambda name: tag + '_' + name
    B = lambda op, name: (op, L(name))
    code = [('newarray', 0), p('slot_rows'), *num(e, 0), p('instance_count')]
    for field in ('characters', 'unison_characters', 'equipments', 'abilitySoulIds'):
        code += [g('party'), *gp(e, field), p('scratch'), *array(e, loc['scratch'], fail, 3)]
    code += [g('party'), *gp(e, 'weapon_rivens'), p('rows_array'),
             g('is_com'), B('iftrue', 'rows_ready'),
             g('has_context'), B('iftrue', 'require_rows'),
             g('rows_array'), ('pushnull',), B('ifeq', 'rows_ready'),
             ('label', L('require_rows')), *array(e, loc['rows_array'], fail, 3),
             ('label', L('rows_ready')), *num(e, 0), p('slot'),
             ('label', L('slot_loop')), ('avm_label',), g('slot'), *num(e, 3), B('ifge', 'done')]
    for idx, (field, subfield) in enumerate((('characters', 'id'), ('unison_characters', 'id'),
                                            ('equipments', 'equipmentId'), ('abilitySoulIds', None))):
        code += [g('party'), *gp(e, field), g('slot'), ('getproperty', DYNAMIC), p('opt'),
                 *option(e, loc['opt'], loc['scalar'], loc['scratch'], fail,
                         L('option_' + str(idx)), subfield),
                 *append(e, loc['canonical'], [g('scalar')])]
    code += [g('scalar'), p('soul'),
             *is_instance(e, loc['soul'], L('instance'), L('ordinary')),
             ('label', L('instance')), ('pushtrue',), p('is_card'),
             ('inclocal_i', loc['instance_count']), g('instance_count'), *num(e, 1), ('ifgt', fail),
             g('is_com'), ('iftrue', fail), g('has_context'), ('iffalse', fail),
             g('mode'), ('iffalse', fail), B('jump', 'read_row'),
             ('label', L('ordinary')), ('pushfalse',), p('is_card'),
             g('is_com'), B('iffalse', 'read_row'),
             g('soul'), *num(e, 16000000), ('ifeq', fail),
             ('label', L('read_row')), g('rows_array'), ('pushnull',), B('ifeq', 'empty_row'),
             g('rows_array'), g('slot'), ('getproperty', DYNAMIC), p('opt'),
             g('opt'), ('iffalse', fail), g('opt'), *gp(e, 'index'),
             *num(e, 1), B('ifeq', 'empty_row'), g('opt'), *gp(e, 'index'),
             *num(e, 0), ('ifne', fail), g('is_card'), ('iffalse', fail),
             g('opt'), *gp(e, 'params'), p('scratch'), *array(e, loc['scratch'], fail, 1),
             *at(e, loc['scratch'], 0), p('row'), *array(e, loc['row'], fail),
             g('row'), *gp(e, 'length'), *num(e, 4), ('iflt', fail),
             g('row'), *gp(e, 'length'), *num(e, 10), ('ifgt', fail),
             g('row'), *gp(e, 'length'), *num(e, 2), ('modulo',), *num(e, 0), ('ifne', fail),
             *at(e, loc['row'], 0), g('soul'), ('ifne', fail),
             *append(e, loc['canonical'], [g('row'), *gp(e, 'length')]),
             ('newarray', 0), p('rowcopy'), *num(e, 0), p('term'),
             ('label', L('term_loop')), ('avm_label',), g('term'), g('row'), *gp(e, 'length'),
             B('ifge', 'term_done'), g('row'), g('term'), ('getproperty', DYNAMIC), p('scalar'),
             *integer(e, loc['scalar'], 1, 2147483647, fail),
             g('term'), *num(e, 3), B('iflt', 'term_valid'),
             g('term'), *num(e, 2), ('modulo',), *num(e, 1), B('ifne', 'term_valid'),
             g('scalar'), *num(e, 100), ('ifgt', fail),
             ('label', L('term_valid'))]
    if check_assets:
        code += [g('term'), *num(e, 1), B('ifeq', 'weapon_exists'),
                 g('term'), *num(e, 2), ('modulo',), *num(e, 0), B('ifne', 'asset_done'),
                 g('soul_table'), g('scalar'), *call(e, 'exists', 1), ('iffalse', fail),
                 B('jump', 'asset_done'), ('label', L('weapon_exists')),
                 g('equipment_table'), g('scalar'), *call(e, 'exists', 1), ('iffalse', fail),
                 ('label', L('asset_done'))]
    code += [*append(e, loc['canonical'], [g('scalar')]),
             g('rowcopy'), g('scalar'), *call(e, BUILTIN + 'push', 1, True),
             ('inclocal_i', loc['term']), B('jump', 'term_loop'),
             ('label', L('term_done')), g('slot_rows'), g('rowcopy'),
             *call(e, BUILTIN + 'push', 1, True), B('jump', 'slot_next'),
             ('label', L('empty_row')), g('is_card'), ('iftrue', fail),
             *append(e, loc['canonical'], num(e, 0)), g('slot_rows'), ('pushnull',),
             *call(e, BUILTIN + 'push', 1, True),
             ('label', L('slot_next')), ('inclocal_i', loc['slot']), B('jump', 'slot_loop'),
             ('label', L('done'))]
    return code, first + len(names)
