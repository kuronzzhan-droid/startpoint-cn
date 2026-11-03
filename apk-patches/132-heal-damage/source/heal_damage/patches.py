"""第六轮码30和共享治疗采样，全部原方法只做可逆插入。"""
import asm
from .symbols import symbols,MEMBER
from . import sample,stance,record,timing,emission
TARGETS=['MemberImpl/applyHeal','SquadManagerImpl/updatePhase','AbilityDamageShot/finish','AbilityDamageShot/dispose']

def build(e):
 m=symbols(e);q=m['q']
 register,take=emission.install_metadata(e,m)
 emit=emission.install_emit(e,m,register)
 queue,battle,pending=timing.queue(e,m)
 tick=timing.tick(e,m,battle,pending,emit)
 kind=stance.install(e,m)
 rec=record.install(e,m,kind,queue)
 heal=sample.install(e,m,rec)
 label=TARGETS[0];ins=asm.decode(e.body(label)[5]);assert ins[197].name=='returnvoid'
 e.insert(label,76,[('dup',),('setlocal',9)])
 e.insert(label,197,[('getlocal_0',),('getlocal_1',),('getlocal_2',),('getlocal',4),('getlocal',6),('getlocal',9),('callpropvoid',heal,5)])
 label=TARGETS[1];ins=asm.decode(e.body(label)[5]);assert ins[31].name=='returnvoid'
 e.insert(label,31,[('getlex',q(MEMBER)),('getlocal_0',),('callpropvoid',tick,1)])
 label=TARGETS[2];b=e.body(label);ins=asm.decode(b[5]);assert ins[449].name=='pushbyte' and ins[449].args==[0]
 # Consume metadata even if target vanished; marker=0 leaves old bytecode result untouched.
 e.insert(label,2,[('getlex',q(MEMBER)),('getlocal_0',),('callproperty',take,1),('setlocal',35)])
 e.insert(label,450,[('getlocal',35),('iffalse','UNCHANGED'),('pop',),('getlocal',35),('label','UNCHANGED')])
 e.insert(TARGETS[3],2,[('getlex',q(MEMBER)),('getlocal_0',),('callpropvoid',take,1)])
 return {'targets':TARGETS,'native_attack_reference':2,'reference_task_conflict':'resolved_by_task_author_amendment'}
