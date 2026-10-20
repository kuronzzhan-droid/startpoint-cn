"""Fever内有效加点转能量；小数留在缓存，图标展示1+floor(余量)。"""
from .symbols import GAUGE,SLOT

def install(e,m,s,grant):
 q,x=m['q'],m['x']
 c=[('getlocal_0',),('pushscope',),('getlocal_0',),('callproperty',q('isFeverMode'),0),('iffalse','DONE'),
 ('getlocal_1',),e.number(0),('ifngt','DONE'),e.number(0),('setlocal_2',),('jump','MEMCHECK'),
 ('label','MEMLOOP'),('avm_label',),('getlocal_0',),('getproperty',q('squadManager')),('getproperty',q('primary')),
 ('getlocal_2',),('callproperty',m['exact']('pinball.scene.battle.battle.squad:Squad::getMember'),1),('setlocal_3',),
 ('getlocal_3',),('getproperty',q('index')),e.number(0),('ifne','MEMNEXT'),
 ('getlocal_3',),('getproperty',q('params')),e.number(0),('getproperty',x),('setlocal_3',),
 ('getlocal_3',),('getproperty',q('conditionSlot')),('setlocal',4),
 ('getlocal',4),('getproperty',q('conditions')),('getproperty',q('_keys')),('callproperty',q('copy'),0),('setlocal',5),
 e.number(0),('setlocal',6),('jump','CONDCHECK'),
 ('label','CONDLOOP'),('avm_label',),('getlocal',4),('getproperty',q('conditions')),('getproperty',q('map')),
 ('getlocal',5),('getlocal',6),('getproperty',x),('callproperty',q('get'),1),('setlocal',7),
 ('getlocal',4),('getlocal',7),('callproperty',s['entry'],1),('setlocal',8),('getlocal',8),('iffalse','CONDNEXT'),
 ('getlocal',8),e.number(2),('getproperty',x),('setlocal',9),('getlocal',9),e.number(0),('getproperty',x),e.number(60),('ifne','CONDNEXT'),
 ('getlocal',9),e.number(3),('getproperty',x),('setlocal',10),('getlocal',10),e.number(0),('ifle','CONDNEXT'),
 ('getlocal',9),e.number(2),('getproperty',x),e.number(0),('ifle','CONDNEXT'),
 ('getlex',q(SLOT)),('getlocal',9),e.number(1),('getproperty',x),('getlocal',4),('getproperty',q('asset')),
 ('callproperty',q('wfxSpec'),2),('setlocal',11),('getlocal',11),('iffalse','CONDNEXT'),
 ('getlocal',11),e.number(0),('getproperty',x),e.number(61),('ifne','CONDNEXT'),
 ('getlocal',8),e.number(3),('getlocal',8),e.number(3),('getproperty',x),
 ('getlocal_1',),('getlocal',9),e.number(2),('getproperty',x),('multiply',),e.number(10000),('divide',),('add',),('setproperty',x),
 ('jump','THRESHCHECK'),('label','THRESHLOOP'),('avm_label',),
 ('getlocal',8),e.number(3),('getlocal',8),e.number(3),('getproperty',x),('getlocal',10),('subtract',),('setproperty',x),
 ('getlocal_3',),('getlocal',9),e.number(1),('getproperty',x),e.number(1),('callpropvoid',grant,2),
 ('label','THRESHCHECK'),('getlocal',8),e.number(3),('getproperty',x),('getlocal',10),('ifge','THRESHLOOP'),
 ('getlex',q('Math')),('getlocal',8),e.number(3),('getproperty',x),('callproperty',q('floor'),1),e.number(1),('add',),('setlocal',11),
 ('getlocal',7),('getlocal',11),('setproperty',q('magnificationFromPrimary')),
 ('getlocal',7),('getlocal',11),('setproperty',q('magnificationFromOther')),
 ('getlocal',4),('callpropvoid',q('addRefreshCount'),0),
 ('label','CONDNEXT'),('inclocal_i',6),('label','CONDCHECK'),('getlocal',6),('getlocal',5),('getproperty',q('length')),('iflt','CONDLOOP'),
 ('label','MEMNEXT'),('inclocal_i',2),('label','MEMCHECK'),('getlocal_2',),e.number(3),('iflt','MEMLOOP'),
 ('label','DONE'),('returnvoid',)]
 return e.add_method(GAUGE,'wfxSuperEnergy','void',['Number'],c,12)
