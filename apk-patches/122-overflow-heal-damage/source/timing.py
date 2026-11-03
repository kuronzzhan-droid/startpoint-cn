"""30帧缓存及定时发射；队伍更新时推进，完全没有治疗事件也能结算尾量。"""
from .symbols import MEMBER,ADDR

def install_queue(e,m):
 q,x=m['q'],m['x']
 battle=e.add_slot(MEMBER,'wfxOverflowBattle','Object',static=True)
 pending=e.add_slot(MEMBER,'wfxOverflowPending','Array',static=True)
 # static queue(healer): entry=[healer,due,all,nearest]. Cache bound to exact battle object.
 code=[('getlocal_0',),('pushscope',),('getlocal_0',),('getproperty',battle),
       ('getlocal_1',),('getproperty',q('battle')),('ifstricteq','READY'),
       ('getlocal_0',),('getlocal_1',),('getproperty',q('battle')),('setproperty',battle),
       ('getlocal_0',),('newarray',0),('setproperty',pending),
       ('label','READY'),('getlocal_0',),('getproperty',pending),('setlocal_2',),
       e.number(0),('setlocal_3',),('jump','CHECK'),
       ('label','LOOP'),('avm_label',),('getlocal_2',),('getlocal_3',),('getproperty',x),('setlocal',4),
       ('getlocal',4),e.number(0),('getproperty',x),('getlocal_1',),('ifstricteq','FOUND'),
       ('inclocal_i',3),('label','CHECK'),('getlocal_3',),('getlocal_2',),('getproperty',q('length')),('iflt','LOOP'),
       ('getlocal_1',),('getlocal_1',),('getproperty',q('squadManager')),('getproperty',q('currentFrame')),e.number(30),('add',),
       e.number(0),e.number(0),('newarray',4),('setlocal',4),
       ('getlocal_2',),('getlocal',4),('callpropvoid',m['push'],1),('jump','RESULT'),
       ('label','FOUND'),('getlocal',4),e.number(2),('getproperty',x),e.number(0),('ifgt','RESULT'),
       ('getlocal',4),e.number(3),('getproperty',x),e.number(0),('ifgt','RESULT'),
       ('getlocal_1',),('getproperty',q('squadManager')),('getproperty',q('currentFrame')),('setlocal',5),
       ('getlocal',5),('getlocal',4),e.number(1),('getproperty',x),('iflt','RESULT'),
       ('getlocal',4),e.number(1),('getlocal',5),e.number(30),('add',),('setproperty',x),
       ('label','RESULT'),('getlocal',4),('returnvalue',)]
 queue=e.add_method(MEMBER,'wfxOverflowQueue','Array',['*'],code,6,static=True)
 return queue,battle,pending

def install_emit(e,m):
 q,x=m['q'],m['x']
 # emit(all,nearest), uses this healer's current element and native ability execution count.
 code=[('getlocal_0',),('pushscope',),('newarray',0),('setlocal_3',),
       ('getlocal_1',),e.number(0),('ifngt','NEAR'),
       ('getlocal_0',),('getproperty',q('zoneManager')),
       ('callproperty',m['exact']('pinball.scene.battle.battle.zone:ZoneManager::getCurrentZone'),0),
       ('getlocal_3',),('callpropvoid',m['exact']('pinball.scene.battle.battle.zone:Zone::getAllEnemies'),1),
       ('label','NEAR'),('pushnull',),('setlocal',4),('getlocal_2',),e.number(0),('ifngt','READY'),
       ('getlocal_0',),('callproperty',q('getNearestEnemy'),0),('setlocal',4),
       ('label','READY'),('getlex',q(ADDR)),e.number(0),('getlocal_0',),('getproperty',q('address')),('pushfalse',),
       ('callproperty',q('Instant'),3),('setlocal',5),
       ('getlocal_0',),('callproperty',q('getElement'),0),('setlocal',6),
       ('getlocal_0',),('getproperty',q('abilityDamageExecutionCount')),('setlocal',7),
       e.number(0),('setlocal',8),('jump','CHECK'),
       ('label','LOOP'),('avm_label',),('getlocal_0',),('getlocal_3',),('getlocal',8),('getproperty',x),
       ('getlocal',5),('getlocal',6),e.number(3),('getlocal_1',),('pushfalse',),('getlocal',7),
       ('callpropvoid',q('applyInstantAbilityEnemyDamage'),7),('inclocal_i',8),
       ('label','CHECK'),('getlocal',8),('getlocal_3',),('getproperty',q('length')),('iflt','LOOP'),
       ('getlocal',4),('iffalse','DONE'),('getlocal_0',),('getlocal',4),('getlocal',5),('getlocal',6),e.number(3),
       ('getlocal_2',),('pushfalse',),('getlocal',7),('callpropvoid',q('applyInstantAbilityEnemyDamage'),7),
       ('label','DONE'),('getlocal_0',),('getlocal',7),e.number(1),('add_i',),('setproperty',q('abilityDamageExecutionCount')),('returnvoid',)]
 return e.add_method(MEMBER,'wfxOverflowEmit','void',['Number','Number'],code,9)

def install_tick(e,m,battle,pending,emit):
 q,x=m['q'],m['x']
 code=[('getlocal_0',),('pushscope',),('getlocal_0',),('getproperty',battle),
       ('getlocal_1',),('getproperty',q('battle')),('ifstrictne','DONE'),
       ('getlocal_0',),('getproperty',pending),('setlocal_2',),('getlocal_2',),('iffalse','DONE'),
       ('getlocal_1',),('getproperty',q('currentFrame')),('setlocal_3',),e.number(0),('setlocal',4),('jump','CHECK'),
       ('label','LOOP'),('avm_label',),('getlocal_2',),('getlocal',4),('getproperty',x),('setlocal',5),
       ('getlocal_3',),('getlocal',5),e.number(1),('getproperty',x),('iflt','NEXT'),
       ('getlocal',5),e.number(2),('getproperty',x),('setlocal',6),
       ('getlocal',5),e.number(3),('getproperty',x),('setlocal',7),
       ('getlocal',6),e.number(0),('ifgt','FLUSH'),('getlocal',7),e.number(0),('ifngt','NEXT'),
       ('label','FLUSH'),('getlocal',5),e.number(2),e.number(0),('setproperty',x),
       ('getlocal',5),e.number(3),e.number(0),('setproperty',x),
       ('getlocal',5),e.number(1),('getlocal_3',),e.number(30),('add',),('setproperty',x),
       ('getlocal',5),e.number(0),('getproperty',x),('getlocal',6),('getlocal',7),('callpropvoid',emit,2),
       ('label','NEXT'),('inclocal_i',4),('label','CHECK'),('getlocal',4),('getlocal_2',),('getproperty',q('length')),('iflt','LOOP'),
       ('label','DONE'),('returnvoid',)]
 return e.add_method(MEMBER,'wfxOverflowTick','void',['*'],code,8,static=True)
