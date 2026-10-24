"""真实治疗/窗口/分类/数值测试；每条断言从候选ABC执行。"""
from .runtime import Harness,enum,clean
from .damage_fixture import calculate

FLAGS={1:'createdByMainSkillAction',2:'createdByPowerFlipAction',3:'createdByDirectAttack',4:'createdByAbility'}

def make(abc,kind=4,value=10000,flags=50000,overrides=None,**kw):
 h=Harness(abc,{1:f'wfx:30:{kind}:{value}:{flags}:damage',2:'wfx:27:0:10000:0:old',3:'wfx:31:0:100:200:fever'},overrides=overrides,**kw)
 return h

def parity(before,after,overrides=None):
 checks=[]
 for code in [None,27]:
  for hp,cure in [(0,0),(50,25),(50,50),(50,80),(100,0),(100,.01)]:
   for flags in [{},{'isHealRejected':True},{'isFromHostile':True},{'createdByCoopCommand':True},{'statsBattleId':'remote'},{'createdBySummonsMultiBall':True}]:
    results=[]
    for abc in [before,after]:
     h=Harness(abc,{1:'wfx:27:0:10000:0:old'},overrides=overrides if abc is after else None)
     m=h.unit([h.condition(1)] if code else []);t=h.unit(hp=hp);n=[0];original=t['getRealMaximumHealthPoint']
     def maximum():n[0]+=1;return original()
     t['getRealMaximumHealthPoint']=maximum
     h.heal(t,cure,**flags);h.tick(60);results.append([h.snapshot(),n[0]])
    assert results[0]==results[1],(code,hp,cure,flags);checks.append(f'旧{code}/{hp}/{cure}/{flags}')
 for ref in [0,1,2,3]:
  results=[]
  for abc in [before,after]:
   h=Harness(abc,overrides=overrides if abc is after else None);m=h.unit();h.shot(m,h.enemies[0],enum(1,0,m['address'],False),1,ref,100000,False,9);results.append(h.snapshot())
  assert results[0]==results[1],ref;checks.append(f'原reference{ref}完整产物与分类链')
 return checks

def scenarios(abc,overrides=None):
 checks=[]
 def mk(kind=4,value=10000,flags=50000,**kw):return make(abc,kind,value,flags,overrides,**kw)
 def mark(s):checks.append(s)
 def strength(h,want):assert [s['strength']/100000 for s in h.shots]==[want]*2,h.shots
 for kind in range(1,5):
  for hp,cure,want in [(80,20,20),(100,10,50),(80,30,70),(100,0,0),(0,100,100),(199.99,.02,.03)]:
   maxhp=200 if hp==199.99 else 100
   h=mk(kind);h.unit([h.condition(1)]);t=h.unit(hp=hp,maxhp=maxhp);h.heal(t,cure);h.tick(30)
   if not want:assert not h.shots
   else:
    assert all(abs(s['strength']/100000-want)<1e-9 for s in h.shots) and len(h.shots)==2
    for _,impact in h.impacts:
     attack=impact['content'];assert attack[FLAGS[kind]] and sum(bool(attack[n]) for n in FLAGS.values())==1
     assert attack['powerFlipChargeLv']==(3 if kind==2 else 0) and attack['originMemberIndex']==0 and attack['reference']['index']==1
   mark(f'分类{kind}-有效溢出-{hp}/{cure}')
 for kind in [1,2,3,4,0,5,-1]:
  for concepts,want in [([1],1),([2],2),([3],3),([4],4),([],4),([0],4),([5],4),(None,4)]:
   stance={} if concepts is None else {129989:{'main_stance':{'concepts':concepts}}}
   h=mk(kind,stance=stance);h.unit([h.condition(1)]);t=h.unit(hp=80);h.heal(t,20);h.tick(30)
   if kind not in range(5):assert not h.shots
   else:
    actual=want if kind==0 else kind;assert h.impacts[0][1]['content'][FLAGS[actual]]
    assert h.stance_calls['table']==(1 if kind==0 else 0)
   mark(f'arg{kind}/concepts{concepts}')
 for stanza,loaded in [({129989:{'main_stance':None}},True),({},False)]:
  h=mk(0,stance=stanza,stance_loaded=loaded);h.unit([h.condition(1)]);t=h.unit(hp=80);h.heal(t,20);h.tick(30);assert h.impacts[0][1]['content']['createdByAbility'];mark('stance安全回退'+str(loaded))
 h=mk(0,stance={129989:{'main_stance':{'concepts':[2]}}});m=h.unit([h.condition(1)]);t=h.unit(hp=0);h.heal(t,10);h.stance={};h.heal(t,10);h.tick(30);strength(h,20);assert h.stance_calls['table']==1 and h.impacts[0][1]['content']['powerFlipChargeLv']==3;mark('stance按battle缓存')
 # Five recipients: 5x20% effective plus one 10% overflow = 150x.
 h=mk();m=h.unit([h.condition(1)]);targets=[h.unit(hp=80) for _ in range(5)]
 for i,t in enumerate(targets):h.heal(t,30 if i==0 else 20)
 h.tick(30);strength(h,150);mark('五目标150倍')
 # Target HP normalization, layer snapshots, overflow27 coexistence and current element.
 h=mk();c=h.condition(1,2);m=h.unit([c,h.condition(2)]);t=h.unit(hp=160,maxhp=200)
 h.heal(t,60);c['magnificationFromPrimary']=3;c['magnificationFromOther']=3;h.tick(10);h.heal(t,10);h.tick(19);assert not h.shots
 m['elementState'][0]=6;h.tick();assert [s['strength'] for s in h.shots]==[30,30,21500000,21500000] and all(s['element']==6 for s in h.shots);mark('百分比单位/多层快照/码27并存/当前元素')
 # Independent categories start their own windows, not the first healer window.
 h=mk();m=h.unit([h.condition(1)]);t=h.unit(hp=0);h.heal(t,10);h.tick(5)
 h.table[4]='wfx:30:1:10000:0:second';m['conditionSlot']=h.slot([h.condition(4)]);h.heal(t,10);h.tick(24);assert not h.shots;h.tick();assert len(h.shots)==2;h.tick(5);assert len(h.shots)==4 and h.shots[-1]['frame']==35;mark('每治疗者每分类独立窗口')
 h=mk();a=h.unit([h.condition(1)]);b=h.unit([h.condition(1)]);t=h.unit(hp=0);h.heal(t,10,origin=0);h.tick(5);h.heal(t,10,origin=1);h.tick(25);assert len(h.shots)==2;h.tick(5);assert len(h.shots)==4;mark('不同治疗者独立窗口')
 # Cooldown tail, idle reopen, no ticks during pause.
 h=mk();m=h.unit([h.condition(1)]);t=h.unit(hp=0);h.heal(t,1);h.tick(30);h.heal(t,2);h.tick(29);assert len(h.shots)==2;h.tick();assert h.shots[-1]['frame']==60 and h.shots[-1]['strength']==200000;h.tick(100);h.heal(t,3);assert len(h.shots)==4;h.tick(29,mode=1);assert len(h.shots)==4;h.tick();assert h.shots[-1]['frame']==190;mark('冷却尾量/空闲重新开窗/暂停/phase1')
 for flag in ['isHealRejected','isFromHostile','createdByCoopCommand','createdBySummonsMultiBall','statsBattleId','emptyMember','negativeOrigin']:
  h=mk();h.unit([h.condition(1),h.condition(3)]);t=h.unit(hp=80);kw={flag:True}
  if flag=='statsBattleId':kw={flag:'remote'}
  if flag=='emptyMember':kw={'origin':2}
  if flag=='negativeOrigin':kw={'origin':-1}
  h.heal(t,30,**kw);h.tick(30);assert not h.shots and not h.fever;mark('共享过滤-'+flag)
 h=mk();m=h.unit([h.condition(1)]);t=h.unit();h.heal(t,5);new={'get_id':lambda:'battle-A','get_allowHealFromOtherPlayers':lambda:True,'initialData':{'get_leaderCharacterId':lambda:1}};h.manager['battle']=new;h.tick(30);assert not h.shots
 for member in h.members:member['battle']=new
 h.heal(t,3);h.tick(30);strength(h,15);mark('battle身份同id隔离')
 h=mk();m=h.unit([h.condition(1,8,stackable=False)]);t=h.unit(hp=80);h.heal(t,20);m['conditionSlot']=h.slot();h.tick(30);strength(h,20);mark('不可叠1层/状态消失保留尾量')
 # Negative contributions cancel within or across events, then retire at due.
 for first,second,want in [(10000,-5000,10),(-10000,5000,0),(10000,-10000,0)]:
  h=mk(value=first,flags=0);h.table[4]=f'wfx:30:4:{second}:0:negative';h.unit([h.condition(1),h.condition(4)]);t=h.unit(hp=0);h.heal(t,20);h.tick(30)
  if want:strength(h,want)
  else:assert not h.shots
  assert h.lex['MemberImpl']['wfxHealDamagePending'][0][3]==0;mark(f'有符号同分类总和{first}/{second}')
 h=mk(value=-10000,flags=0);m=h.unit([h.condition(1)]);t=h.unit(hp=0);h.heal(t,20);h.tick(30);assert not h.shots;h.table[4]='wfx:30:4:10000:0:positive';m['conditionSlot']=h.slot([h.condition(4)]);h.heal(t,10);h.tick(30);strength(h,10);mark('负到期余额清零后新窗口')
 h=mk(value=10000,flags=0);m=h.unit([h.condition(1)]);t=h.unit(hp=0);h.heal(t,20);h.tick(10);h.table[4]='wfx:30:4:-5000:0:negative';m['conditionSlot']=h.slot([h.condition(4)]);h.heal(t,20);h.tick(20);strength(h,10);mark('跨治疗有符号抵扣')
 h=mk(4);m=h.unit([h.condition(1)]);m['abilityTotalizer']['wfResolveDamageType']=lambda source:1;t=h.unit(hp=80);h.heal(t,20);h.tick(30);assert all(o['content']['createdByAbility'] for _,o in h.impacts);mark('固定分类显式覆盖旧damageRule')
 # Delayed flights retain per-category markers, retire even target disappears.
 h=mk(delayed=True);m=h.unit([h.condition(1)]);t=h.unit(hp=0);h.heal(t,10);h.tick(30);h.table[4]='wfx:30:2:10000:0:pf';m['conditionSlot']=h.slot([h.condition(4)]);h.heal(t,10);h.tick(30);h.flights[0]['target']=None;h.finish(reverse=True);assert len(h.impacts)==3 and h.impacts[0][1]['content']['powerFlipChargeLv']==3 and h.impacts[-1][1]['content']['createdByAbility'];assert h.lex['MemberImpl']['wfxHealShots']==[];mark('异步反序/目标消失/分类隔离/回收')
 h=mk(delayed=True);h.unit([h.condition(1)]);t=h.unit(hp=0);h.heal(t,10);h.tick(30);assert len(h.lex['MemberImpl']['wfxHealShots'])==2;h.flights[0]['dispose']();h.flights[0]['dispose']();assert len(h.lex['MemberImpl']['wfxHealShots'])==1;h.purge();assert h.lex['MemberImpl']['wfxHealShots']==[] and not h.flights and not h.impacts;mark('真实purge/dispose回收与重复dispose幂等')
 h=mk();h.unit([h.condition(1)]);t=h.unit();h.enemies=[];h.heal(t,10);h.tick(30);assert not h.shots and h.lex['MemberImpl']['wfxHealShots'] in ([],None);mark('无敌人不延迟/不泄漏映射')
 for kind in range(1,5):
  h=mk(kind);h.unit([h.condition(1)]);t=h.unit(hp=80);h.heal(t,30);h.tick(30);r,s=calculate(h,h.impacts[0][1]['content'],kind=kind)
  assert r['damage']==15750000 and s['basePoint']==1500 and s['step2Multiplier']==7000000
  assert r[FLAGS[kind]] and s[FLAGS[kind]] and r['originMemberIndex']==0 and r['powerFlipChargeLv']==(3 if kind==2 else 0);mark(f'原生完整calculator分类{kind}:1000x1.5x70x2x0.75=157500')
 return checks
