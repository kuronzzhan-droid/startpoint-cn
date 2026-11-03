"""按治疗者与分类分窗，使用原生逻辑帧，不读墙钟。"""
from .symbols import MEMBER

def queue(e,m):
 q,x=m['q'],m['x']; battle=e.add_slot(MEMBER,'wfxHealDamageBattle','Object',static=True); pending=e.add_slot(MEMBER,'wfxHealDamagePending','Array',static=True)
 code=[('getlocal_0',),('pushscope',),('getlocal_0',),('getproperty',battle),('getlocal_1',),('getproperty',q('battle')),('ifstricteq','READY'),('getlocal_0',),('getlocal_1',),('getproperty',q('battle')),('setproperty',battle),('getlocal_0',),('newarray',0),('setproperty',pending),
 ('label','READY'),('getlocal_0',),('getproperty',pending),('setlocal_3',),e.number(0),('setlocal',4),('jump','CHECK'),('label','LOOP'),('avm_label',),('getlocal_3',),('getlocal',4),('getproperty',x),('setlocal',5),('getlocal',5),e.number(0),('getproperty',x),('getlocal_1',),('ifstrictne','NEXT'),('getlocal',5),e.number(1),('getproperty',x),('getlocal_2',),('ifeq','FOUND'),('label','NEXT'),('inclocal_i',4),('label','CHECK'),('getlocal',4),('getlocal_3',),('getproperty',q('length')),('iflt','LOOP'),
 ('getlocal_1',),('getlocal_2',),('getlocal_1',),('getproperty',q('squadManager')),('getproperty',q('currentFrame')),e.number(30),('add',),e.number(0),('newarray',4),('setlocal',5),('getlocal_3',),('getlocal',5),('callpropvoid',m['push'],1),('jump','RESULT'),
 ('label','FOUND'),('getlocal',5),e.number(3),('getproperty',x),e.number(0),('ifne','RESULT'),('getlocal_1',),('getproperty',q('squadManager')),('getproperty',q('currentFrame')),('setlocal',6),('getlocal',6),('getlocal',5),e.number(2),('getproperty',x),('iflt','RESULT'),('getlocal',5),e.number(2),('getlocal',6),e.number(30),('add',),('setproperty',x),('label','RESULT'),('getlocal',5),('returnvalue',)]
 return e.add_method(MEMBER,'wfxHealDamageQueue','Array',['*','int'],code,7,static=True),battle,pending

def tick(e,m,battle,pending,emit):
 q,x=m['q'],m['x']
 code=[('getlocal_0',),('pushscope',),('getlocal_0',),('getproperty',battle),('getlocal_1',),('getproperty',q('battle')),('ifstrictne','DONE'),('getlocal_0',),('getproperty',pending),('setlocal_2',),('getlocal_2',),('iffalse','DONE'),('getlocal_1',),('getproperty',q('currentFrame')),('setlocal_3',),e.number(0),('setlocal',4),('jump','CHECK'),
 ('label','LOOP'),('avm_label',),('getlocal_2',),('getlocal',4),('getproperty',x),('setlocal',5),('getlocal_3',),('getlocal',5),e.number(2),('getproperty',x),('iflt','NEXT'),('getlocal',5),e.number(3),('getproperty',x),('setlocal',6),('getlocal',6),e.number(0),('ifeq','NEXT'),('getlocal',5),e.number(3),e.number(0),('setproperty',x),('getlocal',5),e.number(2),('getlocal_3',),e.number(30),('add',),('setproperty',x),('getlocal',6),e.number(0),('ifngt','NEXT'),('getlocal',5),e.number(0),('getproperty',x),('getlocal',5),e.number(1),('getproperty',x),('getlocal',6),('callpropvoid',emit,2),
 ('label','NEXT'),('inclocal_i',4),('label','CHECK'),('getlocal',4),('getlocal_2',),('getproperty',q('length')),('iflt','LOOP'),('label','DONE'),('returnvoid',)]
 return e.add_method(MEMBER,'wfxHealDamageTick','void',['*'],code,7,static=True)
