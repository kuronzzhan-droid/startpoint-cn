"""执行最终ABC原生状态构造/叠层/图标/到期/移除；外围资源和射击服务为夹具。"""
import math
import asm,bodies
from .base_runtime import Harness as Base,VM,CODE_CACHE

def en(index,*params):return {'index':index,'params':list(params)}
def noop(*a):return None
CTORS={}

def smap():
 h={}
 def remove(k):
  if k not in h:return False
  del h[k];return True
 return {'h':h,'get':h.get,'exists':lambda k:k in h,'remove':remove}

class Harness(Base):
 def __init__(self,abc,table=None,loaded=True,overrides=None):
  super().__init__(abc,table,loaded,overrides)
  self.labels=set(bodies.label_map(abc).values())
  self.events=[];self.shots=[];self.executed=set();self.steps=0
  self.lex['ConditionSlot'].update(wfxSuperBattle=None,wfxSuperStates=None)
  self.lex['BattleConstants']['HUD_CONDITION_ICON_BLINKING_TIME']=120
  self.lex.update({
   'Boot':{'skip_constructor':False},'Math':{'floor':math.floor,'max':max,'min':min,'NaN':math.nan},
   'ConditionDiscriminationKey_Impl_':{'EMPTY':''},
   'ConditionOverwriteStrategy':{'ChooseOneWithLongerRemainingTime':en(0)},
   'ConditionChangeContent':{'Unique':lambda *a:en(31,*a)},
   'ConditionId_Impl_':{'intToString':lambda n:str(int(n))},
   'ConditionChangeContentTools':{},'Type':{'typeof':lambda k:en(6),'enumEq':lambda a,b:a==b},
   'Decimal_Impl_':{'toFloat':lambda n:n/100000,'fromInt':lambda n:n*100000},
   'InstantAbilityAddress':{'Instant':lambda *a:en(1,*a)},'Maybe_Impl_':{'tmp':None},
  })
  for n in ['fit','isConsumable','getConsumableCount','getDirection']:
   self.lex['ConditionChangeContentTools'][n]=lambda *a,n=n:self.run('ConditionChangeContentTools$/'+n,self.lex['ConditionChangeContentTools'],*a)
  self.lex['ConditionChangeResultContent']=VM.Cls('ConditionChangeResultContent',lambda *a:self.construct('pinball.online.battle.impact.condition::ConditionChangeResultContent',*a))
  self.lex['Condition']=VM.Cls('Condition',lambda *a:self.construct('pinball.common.data.character.condition::Condition',*a))
  self.asset['getPlayhead']=lambda path:{'gotoAndPlay':noop,'advanceFrame':noop}
  self.battle={'get_id':lambda:'local','__isMyBattle__':lambda:True}
  self.members=[];self.manager={'battle':self.battle,'currentFrame':0,'primary':{'getMember':self.get_member}}
  self.enemies=[{'id':'a'},{'id':'b'}]
  self.zone={'getAllEnemies':lambda a:a.extend(self.enemies)}
  self.zone_manager={'getCurrentZone':lambda:self.zone,'executeAbilityDamage':self.shot}
  self.gauge={'state':en(2),'squadManager':self.manager,'whiteGauge':False,'whiteGaugeStartFeverPointRate':0,
   'whiteGaugeFrameCount':0,'xdebugSettings':{'zoneMaximizeFeverGaugeChargingSpeed':False},
   'feverPoint':{'min':0,'max':100,'value':0,'getRatio':lambda:.5},
   'stats':{'add':lambda *a:self.events.append(('gauge-stat',a))},'abilityTrigger':{'countUp':noop},
   'isChangeable':lambda b:True}
  names=['isFeverMode','addFeverPoint']
  if self.has('FeverPointGaugeImpl/wfxSuperEnergy'):names+=['wfxSuperEnergy']
  self.bind(self.gauge,'FeverPointGaugeImpl',names)
  fp=self.gauge['feverPoint']
  self.bind(fp,'ClosedInterval',['set'])
  fp['add']=lambda n:(self.events.append(('gauge',n)),self.run('ClosedInterval/add',fp,n))[-1]

 def has(self,label):return label in self.labels
 def run(self,label,this,*args):
  self.executed.add(label)
  if self.steps>300000:raise AssertionError('nested native instruction budget exhausted')
  code=self.overrides.get(label)
  if code is None:
   key=id(self.abc)
   if key not in CODE_CACHE:CODE_CACHE[key]=(self.abc,{v:k for k,v in bodies.label_map(self.abc).items()},{})
   _,labels,decoded=CODE_CACHE[key]
   if label not in decoded:decoded[label]=asm.decode(self.abc.bodies[labels[label]][5])
   code=decoded[label]
  vm=VM.Interp(self.abc,self.lex,max_steps=20000)
  try:return vm.run(code,[this,*args])
  finally:self.steps+=vm.steps
 def _get(self,uid):
  self.calls['get']+=1
  value=self.table[uid]
  if isinstance(value,str):return {'string_id':value}
  return value
 def construct(self,cls,*args):
  key=(id(self.abc),cls)
  if key not in CTORS:
   row=next(r for r in self.abc.instances if self.abc.mn_name(r[0])==cls)
   body=next(b for b in self.abc.bodies if b[0]==row[5])
   CTORS[key]=(self.abc,asm.decode(body[5]))
  obj={}
  if cls.endswith('::Condition'):
   names=['get_currentAccumulation','get_accumulatable','get_magnification','getRemainingTime','hasExpired','hasConsumed',
          'getDisplayNumber','updateBlinkFrameCount','updateLinkedHitCountCheck']
   self.bind(obj,'Condition',names)
  self.executed.add(cls+'/<ctor>')
  VM.Interp(self.abc,self.lex).run(CTORS[key][1],[obj,*args])
  return obj
 def get_member(self,i):
  if int(i) not in (0,1,2):raise VM.AvmThrow('Internal Error: primary.getMember index outside 0..2')
  return en(0,self.members[int(i)]) if int(i)<len(self.members) else en(1)
 def unit(self,primary=True,multiball=False):
  idx=len(self.members)
  member={'originMemberIndex':idx,'isLeader':lambda:idx==0,'isInPrimarySquad':lambda:primary,'isMultiball':lambda:multiball,
   'battle':self.battle,'squadManager':self.manager,'zoneManager':self.zone_manager,'address':{'origin':idx},
   'getElement':lambda:1,'abilityDamageExecutionCount':0,
   'countUpCondition':lambda c:self.events.append(('condition',idx,c['content']['params'][0])),
   'countUpOverwriteCondition':lambda c:self.events.append(('overwrite',idx,c['content']['params'][0])),
   'countUpExpiredCondition':lambda c:self.events.append(('expired',idx,c['content']['params'][0]))}
  slot={'conditions':{'_keys':[],'map':smap()},'asset':self.asset,'ownerMember':member,'ownerEnemy':None,
   'owner':en(2),'squadManager':self.manager,'squad':en(1),'squadSlot':en(1),'invisibleSlot':None,
   'get_isInvisibleSlot':lambda:False,'iconEffectPlayheads':smap(),'applicationResolver':smap(),'frameCount':0,
   'refreshIndex':0,'prevRefreshIndex':0,'prevTotalDebuffCounts':0,'reservedConditions':{'h':None,'length':0},
   'countHandlers':[{'executeIfMatch':lambda enemy,c:self.events.append(('185-channel',idx,c['params'][0]))}],
   'accumulationCountHandlers':[{'executeIfMatch':lambda enemy,c,n:self.events.append(('stack-channel',idx,c['params'][0],n))}],
   'missionClientManager':{'notifyCondition':noop},'comboCalculator':{'applyRestriction':noop},'exceptsReductionForStatistics':False}
  self.bind(slot,'ConditionSlot',['setCondition','removeCondition','applyConditionChange','addRefreshCount','getTotalDebuffCounts',
    'exists','wfxCollect','wfxRows','wfxSum','update','purge','forcePurge'])
  if self.has('ConditionSlot/wfxSuperEntry'):self.bind(slot,'ConditionSlot',['wfxSuperEntry','wfxSuperEnd'])
  member['conditionSlot']=slot
  self.bind(member,'MemberImpl',['applyInstantAbilityEnemyDamage'])
  if self.has('MemberImpl/wfxSuperGrant'):self.bind(member,'MemberImpl',['wfxSuperGrant','wfxSuperEmit','wfxSuperRecordDamage','wfxSuperBonus'])
  self.members.append(member);return member
 def shot(self,member,target,address,element,reference,strength,inc,count):
  self.shots.append(dict(owner=member['originMemberIndex'],target=target['id'],element=element,reference=reference,strength=strength,count=count))
 def add_condition(self,member,uid,layers=1,duration=600,maximum=99):
  key='S//UNQ-'+str(uid)+'/'
  c=self.construct('pinball.common.data.character.condition::Condition',key,duration,member['conditionSlot']['frameCount'],duration,
   2147483647,2147483647,2147483647,[],maximum,en(31,uid,layers,en(0),False),True,False,'local',0,False,False,None,layers,0,None,None,'',False)
  self.run('ConditionSlot/setCondition',member['conditionSlot'],key,c)
  return c
 def condition_for(self,member,uid):return member['conditionSlot']['conditions']['map']['get']('S//UNQ-'+str(uid)+'/')
 def layers(self,member,uid):
  c=self.condition_for(member,uid)
  return self.run('Condition/getDisplayNumber',c,0) if c else 0
 def add(self,points,kind=0):self.run('FeverPointGaugeImpl/addFeverPoint',self.gauge,points*100000,True,kind)
 def remove(self,member,uid):self.run('ConditionSlot/removeCondition',member['conditionSlot'],'S//UNQ-'+str(uid)+'/')
 def tick(self,n=1):
  for _ in range(n):
   self.manager['currentFrame']+=1
   for member in self.members:self.run('ConditionSlot/update',member['conditionSlot'],False)

def row(spec,duration=600,maximum=3):
 return {'string_id':spec,'duration_frame':duration,'max_accumulation':en(0,maximum),'flip_limit':en(1),'power_flip_limit':en(1),
 'end_power_flip_limit':en(1),'end_power_flip_accepted_levels':en(1),'condition_direction':en(0),'remove_if_encoffin':False,'cancelable':True}
