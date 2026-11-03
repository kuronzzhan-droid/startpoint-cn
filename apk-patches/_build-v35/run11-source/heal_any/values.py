"""逐次逐成员先量化，再按当时层数加权；不保存档位余数。"""
MEMBER = 'pinball.scene.battle.battle.squad.member::MemberImpl'
DEC = 'pinball.common.math._Decimal::Decimal_Impl_'


def install(e, m):
    q, x = e.q, m['x']
    # row, effective Decimal100, overflow Decimal100, recipient maximum Decimal100.
    code = [('getlocal_0',), ('pushscope',), ('getlex', q('Math')),
            ('getlocal_1',), e.number(0), ('getproperty', x), e.number(10),
            ('divide',), ('callproperty', q('floor'), 1), ('setlocal', 5),
            ('getlocal', 5), e.number(0), ('ifngt', 'CONTINUOUS')]
    for raw, dest in [(2, 6), (3, 7)]:
        # Integer Decimal100 numerators first avoid 29/100*100 rounding below 29.
        code += [('getlex', q('Math')), ('getlocal', raw), e.number(100),
                 ('multiply',), ('getlocal', 4), ('getlocal', 5), ('multiply',),
                 ('divide',), ('callproperty', q('floor'), 1), ('setlocal', dest)]
    code += [('jump', 'WEIGHT'), ('label', 'CONTINUOUS')]
    for raw, dest in [(2, 6), (3, 7)]:
        # Preserve code30/31 arithmetic order for continuous mode.
        code += [('getlocal', raw), ('getlocal', 4), ('divide',), e.number(100),
                 ('multiply',), ('setlocal', dest)]
    code += [('label', 'WEIGHT'), ('getlocal', 6), ('getlocal_1',), e.number(1),
             ('getproperty', x), ('multiply',), ('getlocal', 7), ('getlocal_1',),
             e.number(2), ('getproperty', x), ('multiply',), ('getlocal_1',),
             e.number(3), ('getproperty', x), ('multiply',), ('add',), ('returnvalue',)]
    return e.add_method(MEMBER, 'wfxHealAnyValue', 'Number',
                        ['Array', 'Number', 'Number', 'Number'], code, 8)


def damage(e, m, value):
    q, x = e.q, m['x']
    code = [('getlocal_0',), ('pushscope',), e.number(0), ('setlocal', 5),
            ('jump', 'CHECK'), ('label', 'LOOP'), ('avm_label',), ('getlocal_1',),
            ('getlocal', 5), ('getproperty', x), ('setlocal', 6),
            ('getlocal_0',), ('getlocal', 6), e.number(0), ('getproperty', x),
            e.number(10), ('modulo',), ('callproperty', q('wfxHealDamageKind'), 1),
            ('setlocal', 7), ('getlocal', 7), ('iffalse', 'NEXT'),
            ('getlocal_0',), ('getlocal', 6), ('getlocal_2',), ('getlocal_3',),
            ('getlocal', 4), ('callproperty', value, 4), e.number(10000),
            ('divide',), ('setlocal', 8), ('getlocal', 8), e.number(0), ('ifeq', 'NEXT'),
            ('getlex', q(MEMBER)), ('getlocal_0',), ('getlocal', 7),
            ('callproperty', q('wfxHealDamageQueue'), 2), ('setlocal', 9),
            ('getlocal', 9), e.number(3), ('getlocal', 9), e.number(3),
            ('getproperty', x), ('getlocal', 8), ('add',), ('setproperty', x),
            ('label', 'NEXT'), ('inclocal_i', 5), ('label', 'CHECK'),
            ('getlocal', 5), ('getlocal_1',), ('getproperty', q('length')),
            ('iflt', 'LOOP'), ('returnvoid',)]
    return e.add_method(MEMBER, 'wfxHealAnyDamage', 'void',
                        ['Array', 'Number', 'Number', 'Number'], code, 10)


def fever(e, m, value):
    q, x = e.q, m['x']
    code = [('getlocal_0',), ('pushscope',), e.number(0), ('setlocal', 5),
            e.number(0), ('setlocal', 6), ('jump', 'CHECK'),
            ('label', 'LOOP'), ('avm_label',), ('getlocal', 6), ('getlocal_0',),
            ('getlocal_1',), ('getlocal', 5), ('getproperty', x), ('getlocal_2',),
            ('getlocal_3',), ('getlocal', 4), ('callproperty', value, 4),
            ('add',), ('setlocal', 6), ('inclocal_i', 5), ('label', 'CHECK'),
            ('getlocal', 5), ('getlocal_1',), ('getproperty', q('length')),
            ('iflt', 'LOOP'), ('getlocal', 6), e.number(0), ('ifeq', 'DONE'),
            ('getlocal_0',), ('getproperty', q('zoneManager')),
            ('callproperty', m['exact']('pinball.scene.battle.battle.zone:ZoneManager::getCurrentZone'), 0),
            ('getlex', q(DEC)), ('getlocal', 6), e.number(10000), ('divide',),
            ('callproperty', q('fromFloat'), 1), ('pushtrue',), e.number(101),
            ('callpropvoid', m['exact']('pinball.scene.battle.battle.zone:Zone::addFeverPoint'), 3),
            ('label', 'DONE'), ('returnvoid',)]
    return e.add_method(MEMBER, 'wfxHealAnyFever', 'void',
                        ['Array', 'Number', 'Number', 'Number'], code, 7)
