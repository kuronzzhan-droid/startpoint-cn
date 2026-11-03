"""复用前轮实际AVM解释器，扩展集合边界；不替代被验收方法算法。"""
import sys,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'run2'))
from overflow.runtime import Harness as Base,VM,enum,noop
import bodies
_lookup=VM._lookup

def lookup(obj,key):
 if isinstance(obj,list) and isinstance(key,str) and key.split('::')[-1]=='splice':
  def splice(start,count):
   start,count=int(start),int(count);old=obj[start:start+count];del obj[start:start+count];return old
  return splice
 return _lookup(obj,key)
VM._lookup=lookup

class Harness(Base):
 def __init__(self,abc,table=None,loaded=True,overrides=None,stance=None,stance_loaded=True,delayed=False):
  super().__init__(abc,table,loaded,overrides)
  self.stance=stance or {};self.stance_loaded=stance_loaded;self.stance_calls={'table':0,'exists':0,'get':0};self.delayed=delayed;self.flights=[];self.fever=[]
  self.battle['initialData']={'get_leaderCharacterId':lambda:129989}
  self.lex['CharacterStanceDetailTable']=object()
  self.labels=set(bodies.label_map(abc).values())
  static=self.lex['MemberImpl'];static.update({n:None for n in ['wfxHealDamageBattle','wfxHealDamagePending','wfxHealStanceBattle','wfxHealShotBattle','wfxHealShots']});static['wfxHealStanceKind']=0
  for n in ['wfxHealDamageQueue','wfxHealDamageTick','wfxHealShotRegister','wfxHealShotTake','wfConvertNormalAttack']:
   if 'MemberImpl$/'+n in self.labels:self.bind(static,'MemberImpl$',[n])
  constructor=VM.Cls('ImpactSourceContent',ctor=lambda name,index,params:params[0])
  constructor.statics['NormalAttack']=lambda attack:self.run('ImpactSourceContent$/NormalAttack',constructor,attack)
  self.lex['ImpactSourceContent']=constructor
  self.zone['addFeverPoint']=lambda *a:self.fever.append(a)
 def _table(self,cls):
  if cls is self.lex.get('CharacterStanceDetailTable'):
   self.stance_calls['table']+=1
   if not self.stance_loaded:return None
   def exists(k):self.stance_calls['exists']+=1;return k in self.stance
   def get(k):self.stance_calls['get']+=1;return self.stance[k]
   return {'get_data':lambda:{'exists':exists,'get':get}}
  return super()._table(cls)
 def unit(self,*a,**kw):
  obj=super().unit(*a,**kw);obj['_type']='MemberImpl';obj['abilityTotalizer']={'wfResolveDamageType':lambda source:0}
  for n in ['wfxHealSample','wfxHealDamageRecord','wfxHealDamageKind','wfxHealDamageEmit','wfxHealFever']:
   if 'MemberImpl/'+n in self.labels:self.bind(obj,'MemberImpl',[n])
  return obj
 def shot(self,member,target,address,element,reference,strength,inc,count):
  self.shots.append({'member':member['originMemberIndex'],'target':target['id'],'frame':self.manager['currentFrame'],'element':element,'reference':reference,'strength':strength,'count':count,'address':address})
  obj={'member':member,'target':target,'address':address,'element':element,'reference':reference,'strength':strength,'incrementCombo':inc,'executionCount':count,'zoneManager':self.zone_manager,'playhead':None}
  def dispose():self.run('AbilityDamageShot/dispose',obj);self.events.append(('dispose',))
  obj['dispose']=dispose
  if self.delayed:self.flights.append(obj)
  else:self.run('AbilityDamageShot/finish',obj)
 def purge(self):
  node=None
  for shot in reversed(self.flights):node={'item':shot,'next':node}
  obj={'shots':{'h':node,'clear':self.flights.clear}}
  self.run('AbilityDamageManagerImpl/purge',obj)

 def finish(self,reverse=False):
  flights=list(reversed(self.flights)) if reverse else self.flights[:];self.flights.clear()
  for obj in flights:self.run('AbilityDamageShot/finish',obj)
 def snapshot(self):
  obj=super().snapshot();obj['fever']=self.fever
  obj['impacts']=[{k:v for k,v in o['content'].items() if k!='attacker'} for _,o in self.impacts]
  return clean(obj)

def clean(v):
 if isinstance(v,float) and math.isnan(v):return 'NaN'
 if isinstance(v,dict):return {k:clean(x) for k,x in v.items()}
 if isinstance(v,(tuple,list)):return [clean(x) for x in v]
 return v
