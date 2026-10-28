"""独立链动作地址：复用现有可序列化枚举，保留真实成员地址。"""
HELPER = 'MemberImpl/wfxPfChainAddress'


def install(e):
    q = e.q
    return e.add_method('pinball.scene.battle.battle.squad.member::MemberImpl',
        'wfxPfChainAddress', 'pinball.online.battle.address::ActionEvaluatorAddress',
        ['int'], [
            ('getlocal_0',), ('pushscope',),
            ('getlex', q('pinball.online.battle.address::ActionEvaluatorAddress')),
            ('getlocal_1',),
            ('getlex', q('pinball.online.battle.address::InstantAbilityAddress')),
            e.number(-36), ('getlocal_0',), ('getproperty', q('address')), ('pushtrue',),
            ('callproperty', q('Initial'), 3),
            ('callproperty', q('AbilitySkill'), 2), ('returnvalue',),
        ], 2)
