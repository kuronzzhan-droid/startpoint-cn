"""只复用输入中已有类与原生接口。"""
MEMBER='pinball.scene.battle.battle.squad.member::MemberImpl'
SLOT='pinball.scene.battle.battle.condition::ConditionSlot'
GAUGE='pinball.scene.battle.battle.zone.fever::FeverPointGaugeImpl'
DEC='pinball.common.math._Decimal::Decimal_Impl_'
TABLE='pinball.master.generated::UniqueConditionTable'
CHANGE='pinball.online.battle.impact.condition::ConditionChangeResultContent'
CONTENT='pinball.common.data.character.condition::ConditionChangeContent'
OVERWRITE='pinball.online.battle.impact.condition::ConditionOverwriteStrategy'
OPTION='haxe.ds::Option'
ADDR='pinball.online.battle.address::InstantAbilityAddress'

def symbols(e):
 def exact(name):
  hits=[i for i,x in enumerate(e.abc.multinames) if x[0]==7 and e.abc.mn_name(i)==name]
  assert len(hits)==1,(name,hits)
  return hits[0]
 return dict(q=e.q,x=next(i for i,x in enumerate(e.abc.multinames) if x[0]==0x1b),
             exact=exact,push=exact('http://adobe.com/AS3/2006/builtin::push'))
