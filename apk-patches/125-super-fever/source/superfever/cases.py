"""期望来自TASK3公式；所有观察取自最终SWF真实方法执行。"""
from .runtime import Harness,row,en

E,S,MARK,BONUS=910060,910061,910063,910062

def table():
 return {E:row(f'wfx:60:{S}:10000:10:energy',99999,11),S:row(f'wfx:61:0:2000:{MARK}:super',6,3),
         MARK:row('super_end_marker',1,99),BONUS:row('wfx:62:0:500:0:bonus',99999,99)}

def fresh(abc,overrides=None,data=None,loaded=True):
 h=Harness(abc,table() if data is None else data,loaded,overrides)
 for _ in range(3):h.unit()
 return h

def suite(base,abc,overrides=None,legacy=True):
 checks=[];executed=set();timeline=[]
 def check(name,actual,want):
  if actual!=want:raise AssertionError(f'{name}: actual={actual!r}, expected={want!r}')
  checks.append({'name':name,'actual':actual,'expected':want})
 def use(h):executed.update(h.executed)
 def snap(h,event):
  timeline.append({'event':event,'frame':h.manager['currentFrame'],
   'E_layers':[h.layers(m,E) for m in h.members],'S_layers':[h.layers(m,S) for m in h.members],
   'burst_values':[s['strength'] for s in h.shots]})

 # 旧罗尔夫及无配置分支，全部目标方法完整体前后比较。
 for mode in ([0,1,2] if legacy else []):
  for kind in [0,1,2,3,4,100,101]:
   observations=[]
   for code in [base,abc]:
    h=fresh(code,overrides if code is abc else None,{180000:row('unique_rolf_wt26_super_fever')})
    h.gauge['state']=en(mode);h.gauge['isChangeable']=lambda b,mode=mode:mode==1 or (mode==2 and b)
    for m in h.members:h.add_condition(m,180000,duration=2,maximum=1)
    h.add(.5,kind);h.tick(4);h.remove(h.members[0],180000)
    observations.append((h.events,h.shots,[h.layers(m,180000) for m in h.members],h.gauge['feverPoint']['value']))
    use(h)
   check(f'legacy.mode{mode}.kind{kind}',observations[1],observations[0])

 h=fresh(abc,overrides);h.add_condition(h.members[1],E);snap(h,'开战挂E')
 h.gauge['state']=en(1);h.add(4);check('outside.no_energy',h.layers(h.members[1],E),1);snap(h,'Fever外+4')
 h.gauge['state']=en(2);h.add(4);check('energy.visible5',h.layers(h.members[1],E),5);snap(h,'Fever内+4')
 h.add(6);check('exact.threshold',[h.layers(m,S) for m in h.members],[1,1,1]);check('exact.reset',h.layers(h.members[1],E),1);snap(h,'Fever内+6，S一级')
 h.run('MemberImpl/wfxSuperRecordDamage',h.members[0],100);snap(h,'主小队伤害100')
 h.add(25);check('two.thresholds.native_stack',[h.layers(m,S) for m in h.members],[3,3,3]);check('overflow.retained',h.layers(h.members[1],E),6);snap(h,'Fever内+25，S升三级余5')
 h.run('MemberImpl/wfxSuperRecordDamage',h.members[0],50)
 h.add_condition(h.members[2],BONUS,layers=2)
 h.remove(h.members[0],S);check('burst.flat_ratio_not_s_levels',[s['strength'] for s in h.shots],[45,45]);snap(h,'再伤害50、加成1000，驱散S爆发45')
 check('marker.all_primary',[h.layers(m,MARK) for m in h.members],[1,1,1])
 check('marker.native_185_channels',len([e for e in h.events if e[0]=='185-channel' and e[2]==MARK]),3)
 h.remove(h.members[0],S);check('remove.twice.no_second_burst',len(h.shots),2)
 h.run('MemberImpl/wfxSuperRecordDamage',h.members[0],1000)
 h.add(5);h.run('MemberImpl/wfxSuperRecordDamage',h.members[0],10);h.remove(h.members[0],S)
 check('reentry.resets_total',[s['strength'] for s in h.shots],[45,45,3,3]);snap(h,'S再次进入，只记录新段10，爆发3');use(h)

 for incoming,start,expected in [(10,95,6),(10,100,1),(0,0,1),(-10,50,1)]:
  h=fresh(abc,overrides);h.add_condition(h.members[0],E);h.gauge['feverPoint']['value']=start;h.add(incoming)
  check(f'actual_delta.{start}.{incoming}',h.layers(h.members[0],E),expected);use(h)
 h=fresh(abc,overrides);h.add_condition(h.members[0],E);h.gauge['state']=en(1);h.gauge['feverPoint']['value']=99;h.add(10)
 check('outside.fill.no_energy',h.layers(h.members[0],E),1);check('outside.fill.native_max',h.gauge['feverPoint']['value'],100);use(h)
 h=fresh(abc,overrides);h.add_condition(h.members[0],E);h.add(.05,100)
 check('old724.percent_scale',h.layers(h.members[0],E),6);use(h)
 h=fresh(abc,overrides);h.add_condition(h.members[0],E);h.gauge['xdebugSettings']['zoneMaximizeFeverGaugeChargingSpeed']=True;h.add(.5)
 check('debug_multiplier.actual_delta',h.layers(h.members[0],E),6);use(h)
 h=fresh(abc,overrides);h.add_condition(h.members[0],E);h.gauge['isChangeable']=lambda b:False;h.add(50)
 check('not_changeable.no_energy',h.layers(h.members[0],E),1);use(h)

 d=table();d[E]['string_id']=f'wfx:60:{S}:2500:10:fraction'
 h=fresh(abc,overrides,d);h.add_condition(h.members[2],E)
 for _ in range(3):h.add(1)
 check('fraction.not_lost',h.layers(h.members[2],E),1)
 h.add(1);check('fraction.visible_integer',h.layers(h.members[2],E),2);use(h)

 d=table();d[E+10]=row(f'wfx:60:{S+10}:20000:10:e2',99999,11);d[S+10]=row('wfx:61:0:5000:0:s2')
 h=fresh(abc,overrides,d);h.add_condition(h.members[0],E);h.add_condition(h.members[2],E+10);h.add(15)
 check('multipleE.independent',[(h.layers(m,S),h.layers(m,S+10)) for m in h.members],[(1,3)]*3)
 check('multipleE.remaining',(h.layers(h.members[0],E),h.layers(h.members[2],E+10)),(6,1))
 h.run('MemberImpl/wfxSuperRecordDamage',h.members[0],100)
 h.remove(h.members[0],S+10);check('multipleS.independent_burst',[v['strength'] for v in h.shots],[50,50])
 h.remove(h.members[0],S);check('multipleS.second_burst',[v['strength'] for v in h.shots],[50,50,20,20]);use(h)

 for removed_by in ['remove','expiry','forcePurge','purge']:
  h=fresh(abc,overrides);h.add_condition(h.members[0],S,duration=2);h.run('MemberImpl/wfxSuperRecordDamage',h.members[0],40)
  if removed_by=='purge':h.condition_for(h.members[0],S)['content']['params'][3]=True
  if removed_by=='remove':h.remove(h.members[0],S)
  elif removed_by=='expiry':h.tick(3)
  else:h.run('ConditionSlot/'+removed_by,h.members[0]['conditionSlot'],*([False] if removed_by=='purge' else []))
  check('end.'+removed_by,[v['strength'] for v in h.shots],[8,8]);use(h)

 for base_value,mark,total,expected in [(2000,MARK,0,[]),(2000,0,100,[20,20]),(0,MARK,100,[]),(-1,MARK,100,[])]:
  d=table();d[S]['string_id']=f'wfx:61:0:{base_value}:{mark}:s'
  h=fresh(abc,overrides,d);h.add_condition(h.members[0],S);h.run('MemberImpl/wfxSuperRecordDamage',h.members[0],total);h.remove(h.members[0],S)
  check(f'end_edge.{base_value}.{mark}.{total}',[v['strength'] for v in h.shots],expected)
  check(f'mark_edge.{base_value}.{mark}.{total}',[h.layers(m,MARK) for m in h.members],[1 if mark else 0]*3);use(h)

 for mode in ['remote','not_primary','multiball']:
  h=fresh(abc,overrides)
  if mode=='remote':h.battle['__isMyBattle__']=lambda:False
  elif mode=='not_primary':h.members[0]['isInPrimarySquad']=lambda:False
  else:h.members[0]['isMultiball']=lambda:True
  h.add_condition(h.members[0],E);h.add(15);h.add_condition(h.members[0],S);h.run('MemberImpl/wfxSuperRecordDamage',h.members[0],100);h.remove(h.members[0],S)
  check('scope.'+mode,(h.layers(h.members[0],E),h.shots,[h.layers(m,MARK) for m in h.members]),(1,[],[0]*3));use(h)

 for missing in ['unloaded','missing_E','missing_S','invalid_E','invalid_S','zero_rate','zero_cost','missing_marker']:
  d=table()
  if missing=='missing_E':del d[E]
  elif missing=='missing_S':del d[S]
  elif missing=='invalid_E':d[E]['string_id']='unique_rolf_wt26_super_fever'
  elif missing=='invalid_S':d[S]['string_id']='ordinary'
  elif missing=='zero_rate':d[E]['string_id']=f'wfx:60:{S}:0:10:bad'
  elif missing=='zero_cost':d[E]['string_id']=f'wfx:60:{S}:10000:0:bad'
  elif missing=='missing_marker':del d[MARK]
  h=fresh(abc,overrides,d,missing!='unloaded');h.add_condition(h.members[0],E);h.add(10)
  if missing=='missing_marker':
   h.run('MemberImpl/wfxSuperRecordDamage',h.members[0],100);h.remove(h.members[0],S)
   check('tables.'+missing,[v['strength'] for v in h.shots],[20,20])
  else:check('tables.'+missing,[h.layers(m,S) for m in h.members],[0]*3)
  use(h)
 h=fresh(abc,overrides,loaded=False);h.add_condition(h.members[0],E);h.add(5);h.loaded=True;h.add(10)
 check('tables.retry',[h.layers(m,S) for m in h.members],[1]*3);use(h)
 h=fresh(abc,overrides);h.add_condition(h.members[0],S);h.run('MemberImpl/wfxSuperRecordDamage',h.members[0],100)
 h.battle={'get_id':lambda:'new','__isMyBattle__':lambda:True};h.manager['battle']=h.battle
 for m in h.members:m['battle']=h.battle
 h.run('MemberImpl/wfxSuperRecordDamage',h.members[0],10);h.remove(h.members[0],S)
 check('battle.identity_reset',[v['strength'] for v in h.shots],[2,2]);use(h)

 # 原生update先removeCondition（其中结束旧S），再countUpExpiredCondition回调；回调重新施加同uid必须新开累计。
 h=fresh(abc,overrides);old=h.add_condition(h.members[0],S,duration=1)
 h.run('MemberImpl/wfxSuperRecordDamage',h.members[0],100)
 h.members[0]['countUpExpiredCondition']=lambda c:h.run('MemberImpl/wfxSuperGrant',h.members[0],S,1) if c['content']['params'][0]==S else None
 h.tick(2)
 check('reentrant.expiry.old_burst',[v['strength'] for v in h.shots],[20,20])
 check('reentrant.expiry.new_state',h.layers(h.members[0],S),1)
 h.run('MemberImpl/wfxSuperRecordDamage',h.members[0],10);h.remove(h.members[0],S)
 check('reentrant.expiry.new_total',[v['strength'] for v in h.shots],[20,20,2,2]);use(h)
 h=fresh(abc,overrides);old=h.add_condition(h.members[0],S)
 h.run('MemberImpl/wfxSuperRecordDamage',h.members[0],100);h.remove(h.members[0],S)
 events=list(h.events);h.run('ConditionSlot/wfxSuperEnd',h.members[0]['conditionSlot'],old)
 check('same_instance.end_direct_twice',(h.shots,h.events),([{'owner':0,'target':t,'element':1,'reference':4,'strength':20,'count':0} for t in ['a','b']],events));use(h)
 h=fresh(abc,overrides);h.add_condition(h.members[0],E);h.add(5);h.remove(h.members[0],E);h.add_condition(h.members[0],E);h.add(5)
 check('E.dispel_reentry_resets',(h.layers(h.members[0],E),h.layers(h.members[0],S)),(6,0));use(h)
 h=fresh(abc,overrides);h.add_condition(h.members[0],S);h.enemies.clear();h.run('MemberImpl/wfxSuperRecordDamage',h.members[0],100);h.remove(h.members[0],S)
 check('end.no_enemy.still_marks',(h.shots,[h.layers(m,MARK) for m in h.members]),([],[1]*3));use(h)
 d=table();d[S]['string_id']='wfx:61:0:2000:0:no_marker'
 h=fresh(abc,overrides,d);h.add_condition(h.members[0],S);h.add_condition(h.members[0],BONUS,layers=1)
 shared=h.slot([h.condition(BONUS,layers=3)])
 shared['owner']=en(0);h.bind(shared,'ConditionSlot',['applyConditionChange'])
 shared['invisibleSlot']=h.slot([h.condition(BONUS,layers=1)],invisible=True)
 for member in h.members:member['conditionSlot']['squadSlot']=en(0,shared)
 h.members[1]['conditionSlot']['invisibleSlot']=h.slot([h.condition(BONUS,layers=2)],invisible=True)
 h.run('MemberImpl/wfxSuperRecordDamage',h.members[0],100);h.remove(h.members[0],S)
 check('bonus.shared_slot_once',[s['strength'] for s in h.shots],[55,55]);use(h)
 for bonus,want in [(-500,[15,15]),(-2000,[]),(-3000,[])]:
  d=table();d[BONUS]['string_id']=f'wfx:62:0:{bonus}:0:signed_bonus'
  h=fresh(abc,overrides,d);h.add_condition(h.members[0],S);h.add_condition(h.members[1],BONUS)
  h.run('MemberImpl/wfxSuperRecordDamage',h.members[0],100);h.remove(h.members[0],S)
  check(f'bonus.signed.{bonus}',[s['strength'] for s in h.shots],want)
  check(f'bonus.signed_marker.{bonus}',[h.layers(m,MARK) for m in h.members],[1]*3);use(h)
 # 保留原生185同状态/成员/帧去重：同帧重复施加仍叠层，下帧再通知。
 d=table();d[MARK]['duration_frame']=100
 h=fresh(abc,overrides,d)
 h.run('MemberImpl/wfxSuperGrant',h.members[0],MARK,1)
 h.run('MemberImpl/wfxSuperGrant',h.members[0],MARK,1)
 check('marker.same_frame.native_layers',[h.layers(m,MARK) for m in h.members],[2]*3)
 check('marker.same_frame.native_185_dedup',len([e for e in h.events if e[0]=='185-channel' and e[2]==MARK]),3)
 h.tick(1);h.run('MemberImpl/wfxSuperGrant',h.members[0],MARK,1)
 check('marker.next_frame.native_185',len([e for e in h.events if e[0]=='185-channel' and e[2]==MARK]),6);use(h)
 return {'checks':checks,'executed_methods':sorted(executed),'timeline':timeline}
