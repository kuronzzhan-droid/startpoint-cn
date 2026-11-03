"""可编码且通过静态校验的真实语义变异；每个独立执行完整新矩阵。"""
import copy
import asm,bodies
from static_check import check_body
from .cases import scenarios,parity
HELPERS=['MemberImpl/wfxHealSample','MemberImpl/wfxHealDamageKind','MemberImpl/wfxHealDamageRecord','MemberImpl$/wfxHealDamageQueue','MemberImpl$/wfxHealDamageTick','MemberImpl/wfxHealDamageEmit','MemberImpl$/wfxHealShotRegister','MemberImpl$/wfxHealShotTake']
FLIP={'iftrue':'iffalse','iffalse':'iftrue','iflt':'ifge','ifgt':'ifle','ifngt':'ifgt','ifeq':'ifne','ifne':'ifeq','ifstricteq':'ifstrictne','ifstrictne':'ifstricteq'}

def candidates(before,after):
 for label in ['MemberImpl/applyHeal','SquadManagerImpl/updatePhase','AbilityDamageShot/finish','AbilityDamageShot/dispose']:
  yield label,'restore-v35e',asm.decode(before.bodies[bodies.resolve(before,label)][5])
 for label in HELPERS:
  code=asm.decode(after.bodies[bodies.resolve(after,label)][5])
  for i,ins in enumerate(code):
   change=None
   if ins.name in FLIP:change=(FLIP[ins.name],None)
   if ins.name=='pushbyte' and ins.args[0] in [30,100,101,102,104]:change=('pushbyte',[ins.args[0]+1])
   if ins.name in ['multiply','divide','subtract'] and ('Sample' in label or 'Record' in label or 'ShotTake' in label):change=({'multiply':'add','divide':'multiply','subtract':'add'}[ins.name],None)
   if 'Emit' in label and ins.name=='pushbyte' and ins.args[0]==2:change=('pushbyte',[0])
   if 'ShotTake' in label and ins.name in ['pushint','pushuint','pushdouble'] and getattr(after,{'pushint':'ints','pushuint':'uints','pushdouble':'doubles'}[ins.name])[ins.args[0]]==133:change=('pushbyte',[102])
   if change:
    mut=copy.deepcopy(code);mut[i].op=asm.MNEMONICS[change[0]]
    if change[1] is not None:mut[i].args=change[1]
    yield label,f'{i}.{ins.name}-to-{change[0]}.{change[1]}',mut

def run(before,after):
 rows=[]
 for label,name,code in candidates(before,after):
  raw,_=asm.encode(code);assert asm.encode(asm.decode(raw))[0]==raw
  body=copy.deepcopy(after.bodies[bodies.resolve(after,label)]);body[5]=raw
  if name=='restore-v35e':body=copy.deepcopy(before.bodies[bodies.resolve(before,label)]);body[0]=after.bodies[bodies.resolve(after,label)][0]
  check_body(after,body)
  try:scenarios(after,{label:asm.decode(raw)})
  except Exception as exc:rows.append({'method':label,'mutation':name,'static_valid':True,'status':'killed','reason':type(exc).__name__+': '+str(exc)[:280]})
  else:rows.append({'method':label,'mutation':name,'static_valid':True,'status':'survived'})
 return rows
