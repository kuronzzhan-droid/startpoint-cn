"""码27公共符号；仅引用输入SWF已存在的类与接口。"""
MEMBER='pinball.scene.battle.battle.squad.member::MemberImpl'
DEC100='pinball.common.math._Decimal100::Decimal100_Impl_'
DEC='pinball.common.math._Decimal::Decimal_Impl_'
ADDR='pinball.online.battle.address::InstantAbilityAddress'
REF='pinball.online.battle.impact.attack::NormalAttackReferenceParameter'

def symbols(e):
    def exact(name):
        hits=[i for i,x in enumerate(e.abc.multinames) if x[0]==7 and e.abc.mn_name(i)==name]
        assert len(hits)==1,(name,hits)
        return hits[0]
    return dict(q=e.q,exact=exact,x=next(i for i,x in enumerate(e.abc.multinames) if x[0]==0x1b),
                push=exact('http://adobe.com/AS3/2006/builtin::push'))
