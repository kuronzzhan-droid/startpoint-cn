"""治疗伤害输出传给原生统计消费方法；比较分类计数而非仅观察攻击flags。"""
import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import bootstrap
from swfabc import SwfAbc
from heal_damage.cases import make
from heal_damage.damage_fixture import calculate

def verify(abc):
 rows=[]
 for kind,stat in [(1,30),(2,26),(3,24),(4,31)]:
  h=make(abc,kind);h.unit([h.condition(1)]);target=h.unit(hp=80);h.heal(target,30);h.tick(30)
  result,stats=calculate(h,h.impacts[0][1]['content'],kind=kind)
  events=[]
  zone_stats={'add':lambda key,value:events.append(('add',key,value)),
              'setMax':lambda key,value:events.append(('max',key,value))}
  enemy={'isBreakableBlock':lambda:False,'isBoss':lambda:False,'isFunnel':lambda:False}
  h.run('BattleZoneStats/summerizeAttackToEnemy',zone_stats,enemy,{'createdByPrimaryBattle':True},result,result['damage'],False)
  chosen=[(k,v) for op,k,v in events if op=='add' and k in (24,26,30,31)]
  assert chosen==[(stat,157500)],(kind,chosen,events)
  if kind==2:assert ('add',29,157500) in events
  routed=[]
  for index,member in enumerate(h.members):
   member['stats']['summerizeAttackResult']=lambda *args,index=index:routed.append(('member',index,args[1]))
   member['stats']['summerizeAttackResultAsOrigin']=lambda *args,index=index:routed.append(('origin',index,args[0]['damage']))
  h.run('SquadManagerImpl/summerizeAttackResult',h.manager,result,result['damage'],False,'enemy0')
  assert routed==[('member',0,15750000),('origin',0,15750000)],routed
  rows.append({'kind':kind,'originMemberIndex':result['originMemberIndex'],'damage':result['damage']/100,
               'category_stat':chosen,'native_stat_events':events,'member_routing':routed})
 return {'status':'pass','cases':rows,'executed':['BattleZoneStats/summerizeAttackToEnemy','SquadManagerImpl/summerizeAttackResult']}

if __name__=='__main__':
 source=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]/'heal_damage'/'probe.swf'
 report=verify(SwfAbc(source).abc)
 (Path(__file__).resolve().parent/'stats-review-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(json.dumps(report,ensure_ascii=False))

