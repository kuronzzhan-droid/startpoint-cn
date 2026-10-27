"""自适应属性→实际开战快照→MemberImpl→码27→完整能力伤害结算集成。"""
from pathlib import Path
import sys,json,hashlib
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import bootstrap
from swfabc import SwfAbc
from party.worlds import world
from party.consumers import snapshot
from overflow.runtime import Harness
from overflow.damage_fixture import calculate
from overflow.origin_review import verify as review_origins
from overflow.regeneration import verify as verify_regeneration

def verify(abc):
 cases=[]
 for flags,learned,want in [({'wfx_adaptive_1210011':'1'},True,0),({},True,1),({'wfx_adaptive_1210011':'1'},False,1),
                            ({'wfx_adaptive_1110011':'1','wfx_adaptive_1210011':'1'},True,0)]:
  e,p,ms,us=world(abc,flags,learned=learned)
  e.lex['ElementKind_Impl_']={'toColorlessable':lambda n:e.run('ElementKind_Impl_$/toColorlessable',{},n)}
  source=snapshot(e,ms[1]);assert source['element']==want,(flags,source['element'],want)
  h=Harness(abc,{1:'wfx:27:0:10000:0:integration'})
  h.lex['ElementKind_Impl_']={'toColorlessable':lambda n:h.run('ElementKind_Impl_$/toColorlessable',{},n)}
  h.unit();healer=h.unit([h.condition(1)]);target=h.unit(hp=80,element=5)
  healer['source']=source
  h.bind(healer,'MemberImpl',['getElement'])
  assert h.run('MemberImpl/getElement',healer)==want
  h.heal(target,60,origin=1);h.tick(30)
  assert len(h.shots)==2 and all(s['element']==want and s['member']==1 and s['strength']==40 for s in h.shots),h.shots
  attack=h.impacts[0][1]['content'];assert attack['element']==want and attack['originMemberIndex']==1
  result,stats=calculate(h,attack,100000,25000)
  assert result['damage']==6000 and result['originMemberIndex']==1 and result['createdByAbility'] is True
  cases.append({'data':flags,'learned':learned,'leader_original_element':0,'healer_original_element':1,
                'snapshot_element':source['element'],'native_member_element':h.run('MemberImpl/getElement',healer),
                'shot_element':h.shots[0]['element'],'attack_element':attack['element'],'base_damage':stats['basePoint'],
                'final_damage':result['damage']/100,'originMemberIndex':result['originMemberIndex'],
                'createdByAbility':result['createdByAbility'],
                'party_methods':sorted(label for label,bi in e.labels.items() if abc.bodies[bi][0] in e.executed)})
 origins=review_origins(abc);regeneration=verify_regeneration(abc)
 return {'status':'pass','checks':len(cases)+origins['checks']+regeneration['checks'],'adaptive_cases':len(cases),'cases':cases,'origin_review':origins,'regeneration':regeneration,'native_element_conversion':'ElementKind_Impl_$/toColorlessable identity实际字节码',
         'complete_chain':['BattleCharacterLogic/getElement','CalculatedBattleCharacterLogic/<ctor>','SquadMemberSource/<ctor>',
          'MemberImpl/getElement','MemberImpl/applyHeal','SquadManagerImpl/updatePhase','MemberImpl/wfxOverflowEmit',
          'MemberImpl/applyInstantAbilityEnemyDamage','AbilityDamageShot/finish','NormalAttackCalculator/_calculate'],
         'limitations':['游戏外部表和运行对象为受控夹具','AIR/设备/真实联机未核实']}

if __name__=='__main__':
 path=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]/'v35b.swf'
 report=verify(SwfAbc(path).abc)
 report['swf_sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
 Path(__file__).with_name('integration-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(report,ensure_ascii=False,indent=2))



