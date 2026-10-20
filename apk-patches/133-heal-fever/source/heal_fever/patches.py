"""码31：按治疗百分比和当次层数计算，然后调用724的原生百分比加槽入口。"""
MEMBER = 'pinball.scene.battle.battle.squad.member::MemberImpl'
DEC = 'pinball.common.math._Decimal::Decimal_Impl_'
TARGETS = []


def build(e):
    q = e.q
    x = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1b)
    def exact(name):
        matches = [i for i in range(len(e.abc.multinames)) if e.abc.mn_name(i) == name]
        assert len(matches) == 1, (name, matches)
        return matches[0]
    # rows are [arg, value*layers, flags, layers, value]; eff/over arguments use 20=20%.
    code = [
        ('getlocal_0',), ('pushscope',),
        ('getlocal_0',), ('getproperty', q('conditionSlot')), e.number(31), ('pushtrue',),
        ('callproperty', q('wfxRows'), 2), ('setlocal_3',),
        e.number(0), ('setlocal', 4), e.number(0), ('setlocal', 6), ('jump', 'CHECK'),
        ('label', 'LOOP'), ('avm_label',),
        ('getlocal_3',), ('getlocal', 4), ('getproperty', x), ('setlocal', 5),
        ('getlocal', 5), e.number(0), ('getproperty', x), e.number(0), ('ifne', 'NEXT'),
        ('getlocal', 6),
        ('getlocal_1',), ('getlocal', 5), e.number(1), ('getproperty', x), ('multiply',),
        ('getlocal_2',), ('getlocal', 5), e.number(2), ('getproperty', x), ('multiply',),
        ('getlocal', 5), e.number(3), ('getproperty', x), ('multiply',),
        ('add',), ('add',), ('setlocal', 6),
        ('label', 'NEXT'), ('inclocal_i', 4),
        ('label', 'CHECK'), ('getlocal', 4), ('getlocal_3',), ('getproperty', q('length')), ('iflt', 'LOOP'),
        ('getlocal', 6), e.number(0), ('ifeq', 'DONE'),
        ('getlocal_0',), ('getproperty', q('zoneManager')),
        ('callproperty', exact('pinball.scene.battle.battle.zone:ZoneManager::getCurrentZone'), 0),
        ('getlex', q(DEC)), ('getlocal', 6), e.number(10000), ('divide',),
        ('callproperty', q('fromFloat'), 1), ('pushtrue',), e.number(101),
        ('callpropvoid', exact('pinball.scene.battle.battle.zone:Zone::addFeverPoint'), 3),
        ('label', 'DONE'), ('returnvoid',),
    ]
    helper = e.add_method(MEMBER, 'wfxHealFever', 'void', ['Number', 'Number'], code, 7)
    return {'capability': 'heal-fever-v1', 'helper': helper, 'targets': TARGETS,
            'native_api': 'Zone.addFeverPoint(Decimal.fromFloat(weightedPercent/10000), true, 101)'}
