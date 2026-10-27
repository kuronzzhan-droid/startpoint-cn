"""装备声明解析；缺键、未加载和非法声明保持旧号段规则。"""
import asm

CHAR = 'pinball.common.data.character::BattleCharacterLogic'


def q(e, name):
    hits = [i for i in range(1, len(e.abc.multinames))
            if e.abc.multinames[i][0] == 7 and e.abc.mn_name(i) == name]
    if len(hits) != 1:
        raise asm.AsmError(f'equipment symbol {name}: {hits}')
    return hits[0]


def dyn(e):
    return next(i for i in range(1, len(e.abc.multinames))
                if e.abc.multinames[i][0] == 0x1b)


def build(e):
    config, param = e.newq('wfxEquipmentConfig'), e.newq('wfxEquipmentParam')
    m = dyn(e)
    # Exact three fields. The Number/int round-trip rejects fractions, NaN,
    # infinities and int32 overflow; empty fields are rejected before Number.
    code = [('getlocal_0',), ('pushscope',), ('getlocal_0',),
            e.string('equipment_rule_'), ('getlocal_1',), ('add',),
            ('callproperty', q(e, 'wfxPartyRead'), 1), ('setlocal_2',),
            ('getlocal_2',), ('iffalse', 'BAD'), ('getlocal_2',), e.string(':'),
            ('callproperty', q(e, 'split'), 1), ('setlocal_2',), ('getlocal_2',),
            ('getproperty', q(e, 'length')), ('pushbyte', 3), ('ifne', 'BAD')]
    for i, loc in enumerate((3, 4, 5)):
        code += [('getlocal_2',), ('pushbyte', i), ('getproperty', m),
                 ('dup',), ('iffalse', 'POP_BAD'), ('convert_d',), ('setlocal', loc),
                 ('getlocal', loc), ('convert_i',), ('getlocal', loc), ('ifne', 'BAD'),
                 ('getlocal', loc), ('pushbyte', 0), ('iflt', 'BAD')]
    code += [('getlocal_3',), ('pushbyte', 6), ('ifgt', 'BAD'),
             ('getlocal_3',), ('pushbyte', 1), ('ifeq', 'BAD'),
             ('getlocal', 5), ('pushbyte', 6), ('ifgt', 'BAD'),
             ('getlocal', 4), ('iffalse', 'NO_DECAY'),
             ('getlocal', 5), ('iffalse', 'BAD'), ('jump', 'GOOD'),
             ('label', 'NO_DECAY'), ('getlocal', 5), ('iftrue', 'BAD'),
             ('label', 'GOOD'), ('getlocal_3',), ('convert_i',),
             ('getlocal', 4), ('convert_i',), ('getlocal', 5), ('convert_i',),
             ('newarray', 3), ('returnvalue',),
             ('label', 'POP_BAD'), ('pop',), ('label', 'BAD'),
             ('pushnull',), ('returnvalue',)]
    e.add_method(CHAR, 'wfxEquipmentConfig', 'Object', ['int'], code, 6)
    e.add_method(CHAR, 'wfxEquipmentParam', 'int', ['int', 'int', 'int'], [
        ('getlocal_0',), ('pushscope',), ('getlocal_0',), ('getlocal_1',),
        ('callproperty', config, 1), ('setlocal', 4), ('getlocal', 4),
        ('iffalse', 'DEFAULT'), ('getlocal', 4), ('getlocal_2',),
        ('getproperty', m), ('convert_i',), ('returnvalue',),
        ('label', 'DEFAULT'), ('getlocal_3',), ('returnvalue',)
    ], 5)
    return config, param
