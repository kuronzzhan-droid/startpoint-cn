"""对实际ConditionSlot对象去重，避免三个成员共享的队伍槽重复计入码62。"""
from .symbols import MEMBER

def install(e,m):
 q,x=m['q'],m['x'];push=m['push'];indexof=m['exact']('http://adobe.com/AS3/2006/builtin::indexOf')
 c=[('getlocal_0',),('pushscope',),('newarray',0),('setlocal_1',),('newarray',0),('setlocal_2',),e.number(0),('setlocal_3',),('jump','MCHECK'),
 ('label','MLOOP'),('avm_label',),('getlocal_0',),('getproperty',q('squadManager')),('getproperty',q('primary')),
 ('getlocal_3',),('callproperty',m['exact']('pinball.scene.battle.battle.squad:Squad::getMember'),1),('setlocal',4),
 ('getlocal',4),('getproperty',q('index')),e.number(0),('ifne','MNEXT'),
 ('getlocal',4),('getproperty',q('params')),e.number(0),('getproperty',x),('getproperty',q('conditionSlot')),('setlocal',4),
 ('getlocal_1',),('getlocal',4),('callpropvoid',push,1),
 ('getlocal_1',),('getlocal',4),('getproperty',q('invisibleSlot')),('callpropvoid',push,1),
 ('getlocal',4),('getproperty',q('squadSlot')),('setlocal',4),('getlocal',4),('iffalse','MNEXT'),
 ('getlocal',4),('getproperty',q('index')),e.number(0),('ifne','MNEXT'),
 ('getlocal',4),('getproperty',q('params')),e.number(0),('getproperty',x),('setlocal',4),('getlocal',4),('iffalse','MNEXT'),
 ('getlocal_1',),('getlocal',4),('callpropvoid',push,1),('getlocal_1',),('getlocal',4),('getproperty',q('invisibleSlot')),('callpropvoid',push,1),
 ('label','MNEXT'),('inclocal_i',3),('label','MCHECK'),('getlocal_3',),e.number(3),('iflt','MLOOP'),
 e.number(0),('setlocal_3',),('newarray',0),('setlocal',5),('jump','SCHECK'),
 ('label','SLOOP'),('avm_label',),('getlocal_1',),('getlocal_3',),('getproperty',x),('setlocal',4),('getlocal',4),('iffalse','SNEXT'),
 ('getlocal_2',),('getlocal',4),('callproperty',indexof,1),e.number(0),('ifge','SNEXT'),
 ('getlocal_2',),('getlocal',4),('callpropvoid',push,1),
 ('getlocal',4),e.number(62),('getlocal',5),('callpropvoid',q('wfxCollect'),2),
 ('label','SNEXT'),('inclocal_i',3),('label','SCHECK'),('getlocal_3',),('getlocal_1',),('getproperty',q('length')),('iflt','SLOOP'),
 e.number(0),('setlocal_3',),e.number(0),('setlocal',6),('jump','RCHECK'),
 ('label','RLOOP'),('avm_label',),('getlocal',6),('getlocal',5),('getlocal_3',),('getproperty',x),e.number(1),('getproperty',x),('add',),('setlocal',6),('inclocal_i',3),
 ('label','RCHECK'),('getlocal_3',),('getlocal',5),('getproperty',q('length')),('iflt','RLOOP'),('getlocal',6),('returnvalue',)]
 return e.add_method(MEMBER,'wfxSuperBonus','Number',[],c,7)
