"""为异步能力弹按地址身份传递分类，复用v28转换器。"""
from .symbols import MEMBER,ADDR,DEC

def install_metadata(e,m):
 q,x=m['q'],m['x']; battle=e.add_slot(MEMBER,'wfxHealShotBattle','Object',static=True); pending=e.add_slot(MEMBER,'wfxHealShots','Array',static=True)
 # register(healer,address,count,kind,remaining); entries retain exact objects, never numeric-address collision.
 code=[('getlocal_0',),('pushscope',),('getlocal_0',),('getproperty',battle),('getlocal_1',),('getproperty',q('battle')),('ifstricteq','READY'),('getlocal_0',),('getlocal_1',),('getproperty',q('battle')),('setproperty',battle),('getlocal_0',),('newarray',0),('setproperty',pending),('label','READY'),('getlocal',5),e.number(0),('ifngt','DONE'),('getlocal_0',),('getproperty',pending),('getlocal_1',),('getlocal_2',),('getlocal_3',),('getlocal',4),('getlocal',5),('newarray',5),('callpropvoid',m['push'],1),('label','DONE'),('returnvoid',)]
 register=e.add_method(MEMBER,'wfxHealShotRegister','void',['*','*','int','int','int'],code,6,static=True)
 code=[('getlocal_0',),('pushscope',),('getlocal_0',),('getproperty',battle),('getlocal_1',),('getproperty',q('member')),('getproperty',q('battle')),('ifstrictne','NONE'),('getlocal_0',),('getproperty',pending),('setlocal_2',),('getlocal_2',),('iffalse','NONE'),e.number(0),('setlocal_3',),('jump','CHECK'),
 ('label','LOOP'),('avm_label',),('getlocal_2',),('getlocal_3',),('getproperty',x),('setlocal',4)]
 for at,prop in [(0,'member'),(1,'address'),(2,'executionCount')]:
  code += [('getlocal',4),e.number(at),('getproperty',x),('getlocal_1',),('getproperty',q(prop)),('ifstrictne','NEXT')]
 code += [('getlocal',4),e.number(4),('getlocal',4),e.number(4),('getproperty',x),e.number(1),('subtract',),('setproperty',x),('getlocal',4),e.number(4),('getproperty',x),e.number(0),('ifgt','RESULT'),('getlocal_2',),('getlocal_3',),e.number(1),('callpropvoid',m['exact']('http://adobe.com/AS3/2006/builtin::splice'),2),('label','RESULT'),('getlocal',4),e.number(3),('getproperty',x),('setlocal',5)]
 for kind,marker in [(1,101),(2,133),(3,104),(4,102)]:
  code += [('getlocal',5),e.number(kind),('ifne','K'+str(kind)),e.number(marker),('returnvalue',),('label','K'+str(kind))]
 code += [('jump','NONE'),('label','NEXT'),('inclocal_i',3),('label','CHECK'),('getlocal_3',),('getlocal_2',),('getproperty',q('length')),('iflt','LOOP'),('label','NONE'),e.number(0),('returnvalue',)]
 take=e.add_method(MEMBER,'wfxHealShotTake','int',['*'],code,6,static=True)
 return register,take

def install_emit(e,m,register):
 q,x=m['q'],m['x']
 code=[('getlocal_0',),('pushscope',),('newarray',0),('setlocal_3',),('getlocal_0',),('getproperty',q('zoneManager')),('callproperty',m['exact']('pinball.scene.battle.battle.zone:ZoneManager::getCurrentZone'),0),('getlocal_3',),('callpropvoid',m['exact']('pinball.scene.battle.battle.zone:Zone::getAllEnemies'),1),
 ('getlocal_0',),('callproperty',q('getElement'),0),('setlocal',5),('getlocal_0',),('getproperty',q('abilityDamageExecutionCount')),('setlocal',6),
 ('getlex',q(DEC)),('getlocal_2',),('callproperty',q('fromFloat'),1),('setlocal_2',),e.number(0),('setlocal',7),('jump','CHECK'),
 ('label','LOOP'),('avm_label',),
 ('getlex',q(ADDR)),e.number(0),('getlocal_0',),('getproperty',q('address')),('pushfalse',),('callproperty',q('Instant'),3),('setlocal',4),
 ('getlex',q(MEMBER)),('getlocal_0',),('getlocal',4),('getlocal',6),('getlocal_1',),e.number(1),('callpropvoid',register,5),
 ('getlocal_0',),('getlocal_3',),('getlocal',7),('getproperty',x),('getlocal',4),('getlocal',5),e.number(2),('getlocal_2',),('pushfalse',),('getlocal',6),('callpropvoid',q('applyInstantAbilityEnemyDamage'),7),('inclocal_i',7),('label','CHECK'),('getlocal',7),('getlocal_3',),('getproperty',q('length')),('iflt','LOOP'),('getlocal_0',),('getlocal',6),e.number(1),('add_i',),('setproperty',q('abilityDamageExecutionCount')),('returnvoid',)]
 return e.add_method(MEMBER,'wfxHealDamageEmit','void',['int','Number'],code,8)
