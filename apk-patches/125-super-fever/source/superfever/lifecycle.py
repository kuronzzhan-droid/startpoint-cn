"""移除S时先关闭实例，再结算一次；全敌reference4交由独立伤害组实现。"""
from .symbols import SLOT,MEMBER,ADDR

def install_emit(e,m):
 q,x=m['q'],m['x']
 c=[('getlocal_0',),('pushscope',),('getlocal_1',),e.number(0),('ifngt','DONE'),
 ('newarray',0),('setlocal_2',),('getlocal_0',),('getproperty',q('zoneManager')),
 ('callproperty',m['exact']('pinball.scene.battle.battle.zone:ZoneManager::getCurrentZone'),0),
 ('getlocal_2',),('callpropvoid',m['exact']('pinball.scene.battle.battle.zone:Zone::getAllEnemies'),1),
 ('getlex',q(ADDR)),e.number(0),('getlocal_0',),('getproperty',q('address')),('pushfalse',),('callproperty',q('Instant'),3),('setlocal_3',),
 ('getlocal_0',),('callproperty',q('getElement'),0),('setlocal',4),
 ('getlocal_0',),('getproperty',q('abilityDamageExecutionCount')),('setlocal',5),e.number(0),('setlocal',6),('jump','CHECK'),
 ('label','LOOP'),('avm_label',),('getlocal_0',),('getlocal_2',),('getlocal',6),('getproperty',x),('getlocal_3',),('getlocal',4),
 e.number(4),('getlocal_1',),('pushfalse',),('getlocal',5),('callpropvoid',q('applyInstantAbilityEnemyDamage'),7),('inclocal_i',6),
 ('label','CHECK'),('getlocal',6),('getlocal_2',),('getproperty',q('length')),('iflt','LOOP'),
 ('getlocal_0',),('getlocal',5),e.number(1),('add_i',),('setproperty',q('abilityDamageExecutionCount')),
 ('label','DONE'),('returnvoid',)]
 return e.add_method(MEMBER,'wfxSuperEmit','void',['Number'],c,7)

def install_end(e,m,s,grant,emit,bonus):
 q,x=m['q'],m['x']
 c=[('getlocal_0',),('pushscope',),('getlocal_1',),('iffalse','DONE'),
 ('getlocal_0',),('getlocal_1',),('callproperty',s['entry'],1),('setlocal_2',),('getlocal_2',),('iffalse','DONE'),
 ('getlocal_2',),e.number(4),('pushfalse',),('setproperty',x),
 ('getlocal_2',),e.number(2),('getproperty',x),('setlocal_3',),
 ('getlocal_3',),e.number(0),('getproperty',x),e.number(61),('ifne','DONE'),
 ('getlocal_0',),('getproperty',q('ownerMember')),('setlocal',4),
 ('getlocal_3',),e.number(2),('getproperty',x),('setlocal',5),('getlocal',5),e.number(0),('ifle','MARK'),
 ('getlocal',5),('getlocal',4),('callproperty',bonus,0),('add',),('setlocal',5),
 ('getlocal',4),('getlocal_2',),e.number(3),('getproperty',x),('getlocal',5),('multiply',),e.number(10000),('divide',),('callpropvoid',emit,1),
 ('label','MARK'),('getlocal',4),('getlocal_3',),e.number(3),('getproperty',x),e.number(1),('callpropvoid',grant,2),
 ('label','DONE'),('returnvoid',)]
 return e.add_method(SLOT,'wfxSuperEnd','void',['*'],c,8)
