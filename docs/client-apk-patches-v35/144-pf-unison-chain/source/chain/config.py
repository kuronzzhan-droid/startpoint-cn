"""码36参数：状态首条有效配置、强制类型位与两种伤害倍率。"""
MEMBER = 'pinball.scene.battle.battle.squad.member::MemberImpl'


def install(e):
    q, n = e.q, e.number
    x = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1b)
    code = [('getlocal_0',), ('pushscope',),
            ('getlocal_0',), ('callproperty', q('getSquadKind'), 0),
            ('getproperty', q('index')), n(0), ('ifne', 'NONE'),
            ('getlocal_0',), ('getproperty', q('source')),
            ('getproperty', q('unisonSpecialityType')), ('setlocal_1',),
            ('getlocal_1',), ('iffalse', 'NONE'),
            ('getlocal_1',), ('getproperty', q('index')), n(0), ('ifne', 'NONE'),
            ('getlocal_0',), ('getproperty', q('conditionSlot')), n(36), ('pushfalse',),
            ('callproperty', q('wfxRows'), 2), ('setlocal_1',),
            ('getlocal_1',), ('getproperty', q('length')), ('iffalse', 'NONE'),
            ('getlocal_1',), n(0), ('getproperty', x), ('setlocal_1',),
            ('getlocal_1',), n(4), ('getproperty', x), ('setlocal_2',),
            ('getlocal_2',), n(0), ('ifgt', 'FEVER'),
            n(10000), ('setlocal_2',), ('label', 'FEVER'),
            ('getlocal_1',), n(2), ('getproperty', x), ('setlocal_3',),
            ('getlocal_3',), n(0), ('ifgt', 'NORMAL'),
            n(10000), ('setlocal_3',), ('label', 'NORMAL'),
            ('getlocal_1',), n(0), ('getproperty', x), n(1), ('bitand',),
            ('getlocal_2',), ('getlocal_3',), ('newarray', 3), ('returnvalue',),
            ('label', 'NONE'), ('pushnull',), ('returnvalue',)]
    config = e.add_method(MEMBER, 'wfxPfConfig', 'Array', [], code, 4)
    enabled = e.add_method(MEMBER, 'wfxPfEnabled', 'Boolean', [], [
        ('getlocal_0',), ('pushscope',), ('getlocal_0',), ('callproperty', config, 0),
        ('convert_b',), ('returnvalue',)], 1)
    return config, enabled
