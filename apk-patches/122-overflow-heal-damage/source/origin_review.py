"""对队长技新号段的独立只读审阅：原生add/count/ctor均执行。"""
from party.worlds import world
from party.consumers import native_add,enum

def verify(abc):
 e,p,ms,us=world(abc,{'wfx_unlock_111001':'7'})
 entries=[(ms[1],23000),(ms[2],24000),(us[0],1021000),(us[1],1022000),(us[2],1023000)]
 results=[]
 for char,origin in entries:
  expected={6:0,7:1,11:0 if char['isUnison'] else 1,12:1 if char['isUnison'] else 0}
  for kind,want in expected.items():
   records=native_add(e,p,char,origin,kind=kind)
   assert len(records)==1 and records[0]['origin']==origin
   assert records[0]['count']['params'][0]==want and records[0]['countWithoutLimit']['params'][0]==want,(origin,kind,records)
   results.append({'origin':origin,'owner':char['id'],'slot':char['index'],'isUnison':char['isUnison'],
                   'trigger_kind':kind,'count':records[0]['count']['params'][0],'count_without_limit':records[0]['countWithoutLimit']['params'][0]})
  denied=native_add(e,p,char,origin,kind=0,preconditions=[enum(6)])
  allowed=native_add(e,p,char,origin,kind=0,preconditions=[enum(7)])
  assert denied==[] and len(allowed)==1,(origin,denied,allowed)
  results.append({'origin':origin,'self_is_leader_precondition':'blocked','self_is_not_leader_precondition':'allowed'})
 return {'status':'pass','checks':len(results),'cases':results,
         'conclusion':'新增主位23000/24000仍在百万位0；合击1021000-1023000仍在百万位1，原202/203计数没有串位；自身为队长前置均拒绝。',
         'scope':'原生BattleAbilitySource.add/getInstantAbiltyCount/WithoutLimit/InstantInitialAbility ctor；未扩展到所有战斗期触发器。'}
