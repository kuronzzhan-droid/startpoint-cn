"""原生持续回复生成→addSelfImpact→FixedHealCalculator→applyHeal完整链。"""
import math
from .runtime import Harness

def verify(abc):
 h=Harness(abc,{1:'wfx:27:0:10000:0:regen'})
 h.unit([h.condition(1)]);t=h.unit(hp=80)
 h.lex['BattleDiffuseKey']={'KBattleId':0}
 h.lex['CommonBattleConstants']={'MAX_CURE':999999999}
 h.lex['Math'].update(min=min)
 h.lex['Decimal_Impl_'].update(multiplyFloat=lambda a,b:a*b/100000)
 h.lex['FloatInt_Impl_'].update(toFloat=float,max=max,floor=lambda n:math.floor(n+2e-10))
 h.lex['ImpactSourceContent']['FixedHeal']=lambda obj:{'kind':'FixedHeal','payload':obj}
 t.update(x=20,y=40,gear={'absorbWithKey':lambda *a:'battle-A'},getStatModifierEaseOfHeal=lambda:0,isHealRejected=lambda _:False)
 h.bind(t,'MemberImpl',['addSelfImpact'])
 original_add=h.zone_manager['addImpact'];heals=[]
 def add(target,obj):
  if isinstance(obj['content'],dict) and obj['content'].get('kind')=='FixedHeal':
   detail=h.run('FixedHealCalculator/calculate',{},target,obj['content']['payload']);heals.append(detail)
   impact={'createdByCoopCommand':obj['createdByCoopCommand'],'hitEffectX':obj['x'],'hitEffectY':obj['y']}
   h.run('MemberImpl/applyHeal',target,impact,detail)
  else:original_add(target,obj)
 h.zone_manager['addImpact']=add
 owner={'shouldCountForMission':True,'statsBattleId':'battle-A','originMemberIndex':0}
 h.run('MemberImpl/applyRegenerationHandler',t,50,owner,1)
 h.tick(10);h.run('MemberImpl/applyRegenerationHandler',t,20,owner,2)
 h.tick(19);assert not h.shots
 h.tick(1);assert [s['strength'] for s in h.shots]==[50,50],h.shots
 assert [row['shouldCountForMission'] for row in heals]==[True,False]
 return {'status':'pass','checks':1,'first_regeneration':50,'first_missing_hp':20,'second_regeneration':20,
         'emitted_base_per_enemy':50,'emitted_frame':30,'originMemberIndex':0,
         'complete_methods':['MemberImpl/applyRegenerationHandler','MemberImpl/addSelfImpact','FixedHealCalculator/calculate','MemberImpl/applyHeal'],
         'boundary':'Zone.addImpact受控分发至真实FixedHealCalculator，不替代治疗/溢出公式。'}
