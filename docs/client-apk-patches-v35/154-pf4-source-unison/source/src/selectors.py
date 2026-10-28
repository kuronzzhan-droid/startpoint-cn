"""在原来源账本上读取 Lv4；原登记、原读取与原等级遮挡保持不变。"""
TOTALIZER = 'pinball.scene.battle.battle.ability::BattleAbilityTotalizerImpl'
MEMBER = 'pinball.scene.battle.battle.squad.member::MemberImpl'
BATTLE = 'pinball.scene.battle.battle::Battle'


def install_row(e):
    q, n = e.q, e.number
    x = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1b)
    # level1, member2, mode3 (0=native,1=main,2=unison), packed4,
    # ledger5, list6, index7, row8. Native latest-instant shielding is intentional.
    code = [('getlocal_0',), ('pushscope',), ('getlocal_2',), n(16),
            ('lshift',), n(1), ('bitor',), ('setlocal', 4),
            ('getlocal_0',), ('callproperty', q('wfxPfLedger'), 0), ('setlocal', 5),
            ('getlocal', 5), n(0), ('getproperty', x), ('setlocal', 6),
            ('getlocal', 6), ('getproperty', q('length')), n(1), ('subtract_i',),
            ('setlocal', 7), ('jump', 'ICHECK'),
            ('label', 'ILOOP'), ('avm_label',),
            ('getlocal', 6), ('getlocal', 7), ('getproperty', x), ('setlocal', 8)]

    def allowed(prefix, next_label):
        return [('getlocal_3',), ('iffalse', prefix + '_ACCEPT'),
                ('getlocal', 8), n(0), ('getproperty', x), ('getlocal', 4),
                ('equals',), ('getlocal_3',), n(2), ('equals',),
                ('ifne', next_label), ('label', prefix + '_ACCEPT')]

    code += allowed('I', 'INEXT')
    code += [('getlocal', 8), n(2), ('getproperty', x), ('getlocal_1',),
             ('callproperty', q('http://adobe.com/AS3/2006/builtin::indexOf'), 1),
             n(-1), ('ifeq', 'DURING'), ('getlocal', 8), ('returnvalue',),
             ('label', 'INEXT'), ('declocal_i', 7),
             ('label', 'ICHECK'), ('getlocal', 7), n(0), ('ifge', 'ILOOP'),
             ('label', 'DURING'), ('getlocal', 5), n(1), ('getproperty', x),
             ('setlocal', 6), n(0), ('setlocal', 7), ('jump', 'DCHECK'),
             ('label', 'DLOOP'), ('avm_label',),
             ('getlocal', 6), ('getlocal', 7), ('getproperty', x), ('setlocal', 8)]
    code += allowed('D', 'DNEXT')
    code += [('getlocal', 8), n(3), ('getproperty', x), ('pushnull',),
             ('callproperty', q('getActiveCount'), 1), n(0), ('ifle', 'DNEXT'),
             ('getlocal', 8), n(2), ('getproperty', x), ('getlocal_1',),
             ('callproperty', q('http://adobe.com/AS3/2006/builtin::indexOf'), 1),
             n(-1), ('ifeq', 'DNEXT'), ('getlocal', 8), ('returnvalue',),
             ('label', 'DNEXT'), ('inclocal_i', 7),
             ('label', 'DCHECK'), ('getlocal', 7), ('getlocal', 6),
             ('getproperty', q('length')), ('iflt', 'DLOOP'),
             ('pushnull',), ('returnvalue',)]
    return e.add_method(TOTALIZER, 'wfxPf4SelectRow', 'Array',
                        ['int', 'int', 'int'], code, 9)


def install_member(e, select):
    q, n = e.q, e.number
    x = next(i for i, row in enumerate(e.abc.multinames) if row[0] == 0x1b)
    # config1, mode2, mainRow3, unisonRow4, selectedRow5, config6.
    code = [('getlocal_0',), ('pushscope',),
            ('getlocal_0',), ('callproperty', q('wfxPfConfig'), 0), ('setlocal_1',),
            n(0), ('setlocal_2',), ('getlocal_1',), ('iffalse', 'MAIN'),
            n(1), ('setlocal_2',), ('label', 'MAIN'),
            ('getlocal_0',), ('getproperty', q('battle')),
            ('getproperty', q('abilityTotalizer')), ('coerce_a',), n(4),
            ('getlocal_0',), ('getproperty', q('originMemberIndex')), ('getlocal_2',),
            ('callproperty', select, 3), ('setlocal_3',),
            ('pushnull',), ('setlocal', 4), ('getlocal_1',), ('iffalse', 'PICK'),
            ('getlocal_1',), n(0), ('getproperty', x), ('iftrue', 'PICK'),
            ('getlocal_0',), ('getproperty', q('battle')),
            ('getproperty', q('abilityTotalizer')), ('coerce_a',), n(4),
            ('getlocal_0',), ('getproperty', q('originMemberIndex')), n(2),
            ('callproperty', select, 3), ('setlocal', 4),
            ('label', 'PICK'), ('getlocal_3',), ('setlocal', 5),
            ('getlocal', 5), ('iftrue', 'CONFIG'),
            ('getlocal', 4), ('setlocal', 5),
            ('getlocal', 5), ('iffalse', 'NONE'),
            ('label', 'CONFIG'), ('getlex', q(BATTLE)),
            ('getlocal_0',), ('getproperty', q('battle')),
            ('getlocal_0',), ('getproperty', q('logicAssets')),
            ('getlocal', 5), n(0), ('getproperty', x),
            ('callproperty', e.newq('wfxPf4SourceConfig'), 3), ('setlocal', 6)]
    for local, label in ((3, 'MAIN_ID'), (4, 'UNISON_ID')):
        code += [('getlocal', local), ('dup',), ('iffalse', label),
                 n(1), ('getproperty', x), ('label', label)]
    code += [('getlocal', 6), n(0), ('getproperty', x),
             ('getlocal', 6), n(1), ('getproperty', x), ('newarray', 4),
             ('returnvalue',), ('label', 'NONE'), ('pushnull',), ('returnvalue',)]
    state = e.add_method(MEMBER, 'wfxPf4State', 'Array', [], code, 7)
    ready = e.add_method(MEMBER, 'wfxPf4ReadyState', 'Array', ['int'], [
        ('getlocal_0',), ('pushscope',), ('getlocal_1',), n(3), ('ifne', 'NONE'),
        ('getlocal_0',), ('callproperty', state, 0), ('setlocal_2',),
        ('getlocal_2',), ('iffalse', 'NONE'),
        ('getlocal_0',), ('getproperty', q('ball')),
        ('astype', q('pinball.scene.battle.battle.squad.ball::BallImpl')), ('setlocal_3',),
        ('getlocal_3',), ('iffalse', 'NONE'),
        ('getlocal_3',), ('getproperty', q('kyubiPowerFlipInitialCombo')),
        ('getlocal_2',), n(2), ('getproperty', x), ('iflt', 'NONE'),
        ('getlocal_2',), ('returnvalue',),
        ('label', 'NONE'), ('pushnull',), ('returnvalue',)], 4)
    action = e.add_method(MEMBER, 'wfxPf4Action', 'String', ['Array', 'Boolean'], [
        ('getlocal_0',), ('pushscope',), ('getlocal_1',), ('iffalse', 'NONE'),
        ('getlocal_1',), ('getlocal_2',), ('convert_i',), ('getproperty', x),
        ('returnvalue',), ('label', 'NONE'), ('pushnull',), ('returnvalue',)], 3)
    chain = e.add_method(MEMBER, 'wfxPf4ChainId', 'String', ['String', 'Array', 'int'], [
        ('getlocal_0',), ('pushscope',), ('getlocal_3',), n(3), ('ifne', 'OLD'),
        ('getlocal_2',), ('getproperty', q('length')), n(4), ('iflt', 'OLD'),
        ('getlocal_0',), ('getlocal_2',), n(3), ('getproperty', x), ('pushtrue',),
        ('callproperty', action, 2), ('setlocal', 4),
        ('getlocal', 4), ('iffalse', 'OLD'), ('getlocal', 4), ('returnvalue',),
        ('label', 'OLD'), ('getlocal_1',), ('returnvalue',)], 5)
    return {'state': state, 'ready': ready, 'action': action, 'chain': chain}
